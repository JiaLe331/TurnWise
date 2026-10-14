"""Live demo: per-viewer sessions replaying the precomputed Mixkit timeline on a demo clock.

Every browser tab gets its own in-memory outlet (header X-Demo-Session). The video player posts
its media position; the session clock advances DEMO_TIME_SCALE sim seconds per media second, and
timeline samples up to that position become observation summaries through the normal ingestion
path. All rules (30 s vacancy, holds, permissions) run unchanged on the demo clock. Accelerated
time never reaches the live outlet.
"""

import json
import threading
import time
from collections import OrderedDict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from turnwise.camera_manifest import CameraManifest
from turnwise.contracts import (
    Actor,
    ActorType,
    CreateHoldRequest,
    CreatePartyRequest,
    HoldAction,
    HoldActionRequest,
    ObservationSubmission,
    OperationalState,
    PartyStatus,
    SeatingHold,
    Table,
    TableAction,
    TableActionRequest,
    TableCheck,
    TableSession,
    TaskAction,
    TaskActionRequest,
    UserRole,
    VisualStatus,
)
from turnwise.domain.context import Context, record_event
from turnwise.domain.errors import DomainError, InvalidTransition
from turnwise.domain.repository import InMemoryRepository
from turnwise.domain.seed import sync_manifests
from turnwise.domain.services import DEMO_OUTLET_ID, Services, build_services
from turnwise.worker.evidence import FrameEvidence, TableSummarizer

DEMO_DIR = Path(__file__).resolve().parents[1] / "demo"
DEMO_TIME_SCALE = 20.0  # sim seconds per media second of the time-lapse
MAX_SESSIONS = 50
MAX_NARRATION = 60
IDLE_EXPIRY_S = 30 * 60
SETUP = Actor(actor_id="demo-setup", actor_type=ActorType.SYSTEM)
HOST_BOT = Actor(actor_id="demo-host-stand", role=UserRole.HOST)  # scripted walk-ins
STAFF = Actor(actor_id="staff-ana", role=UserRole.FLOOR_STAFF)
HOST = Actor(actor_id="host-1", role=UserRole.HOST)

# table_id, capacity, attributes, state at clip start, minutes since that state began
LAYOUT = [
    ("T1", 2, ["window"], OperationalState.READY, 6),
    ("T2", 2, [], OperationalState.OCCUPIED, 38),
    ("T3", 2, [], OperationalState.OCCUPIED, 52),
    ("T4", 6, ["large"], OperationalState.READY, 9),
]
# Walk-ins joining the waitlist at media seconds (scripted for the demo, labelled as such).
ARRIVALS = [
    (1.5, "W1", 2, []),
    (5.0, "W2", 6, []),
    (8.0, "W3", 2, ["window"]),
]


class _Timeline:
    def __init__(self, path: Path) -> None:
        data = json.loads(path.read_text())
        self.duration = data["duration_s"]
        self.manifest = CameraManifest.model_validate(data["manifest"])
        self.samples = data["samples"]
        self.checks = sorted(data["gemini_checks"], key=lambda c: c["t"])
        self.detector = data["detector"]
        self.raw = data


_timeline: _Timeline | None = None


def timeline() -> _Timeline:
    global _timeline
    if _timeline is None:
        _timeline = _Timeline(DEMO_DIR / "mixkit-timeline.json")
    return _timeline


class DemoClock:
    def __init__(self, start: datetime) -> None:
        self.start = start
        self.offset = 0.0

    def now(self) -> datetime:
        return self.start + timedelta(seconds=self.offset)


class DemoSession:
    def __init__(self, mode: str = "guided") -> None:
        self.id = uuid4().hex
        self.lock = threading.Lock()
        self.touched = time.monotonic()
        self.clock = DemoClock(datetime.now(UTC).replace(microsecond=0))
        self.media = 0.0
        self.next_sample = 0
        self.next_check = 0
        self.next_arrival = 0
        self.seq = 0
        self.next_step = 0
        self.events_seen = 0
        self.mode = mode
        self.narration: list[dict] = []
        self.stream = f"demo-{self.id[:8]}"
        tl = timeline()
        self.summarizers = {t.table_id: TableSummarizer(t.table_id) for t in tl.manifest.tables}
        self.pending_checks: dict[str, TableCheck] = {}
        repo = InMemoryRepository(DEMO_OUTLET_ID)
        ctx = Context(repo=repo, clock=self.clock)
        _seed(ctx, tl.manifest)
        self.services: Services = build_services(
            self.clock, repo=repo, camera_manifests=[tl.manifest]
        )

    def sim_at(self, media: float) -> datetime:
        return self.clock.start + timedelta(seconds=media * DEMO_TIME_SCALE)

    def advance(self, media: float) -> None:
        """Replay everything up to `media` (forward only) in media-time order: timeline samples,
        Gemini checks, scripted walk-ins and, in autoplay, the autopilot's staff/host steps."""
        tl = timeline()
        media = min(max(media, self.media), tl.duration)
        while True:
            nxt = self._next_due(media)
            if nxt is None:
                break
            kind, t = nxt
            self.clock.offset = max(self.clock.offset, t * DEMO_TIME_SCALE)
            if kind == "check":
                self._take_check(tl.checks[self.next_check])
                self.next_check += 1
            elif kind == "sample":
                self._take_sample(tl.samples[self.next_sample])
                self.next_sample += 1
            elif kind == "arrival":
                _, code, size, needs = ARRIVALS[self.next_arrival]
                self.next_arrival += 1
                self.services.waitlist.create(
                    CreatePartyRequest(queue_code=code, size=size, requirements=needs),
                    HOST_BOT,
                    f"{self.id}-arrival-{code}",
                )
            else:
                step = AUTOPILOT[self.next_step]
                self.next_step += 1
                if self.mode == "autoplay":
                    self._run_step(step)
            self.services.sweep()
            self._narrate_events()
        self.media = media
        self.clock.offset = media * DEMO_TIME_SCALE
        self.services.sweep()
        self._narrate_events()

    def set_mode(self, mode: str) -> None:
        """Switching to autoplay mid-way starts the autopilot from now; past steps are skipped."""
        self.mode = mode

    def _next_due(self, media: float) -> tuple[str, float] | None:
        tl = timeline()
        due = []
        if self.next_check < len(tl.checks):
            due.append(("check", tl.checks[self.next_check]["t"]))
        if self.next_sample < len(tl.samples):
            due.append(("sample", tl.samples[self.next_sample]["t"]))
        if self.next_arrival < len(ARRIVALS):
            due.append(("arrival", ARRIVALS[self.next_arrival][0]))
        if self.next_step < len(AUTOPILOT):
            due.append(("step", AUTOPILOT[self.next_step].t))
        due = [d for d in due if d[1] <= media]
        # Checks attach to the next summary, so they go first at equal times.
        order = {"check": 0, "arrival": 1, "step": 2, "sample": 3}
        return min(due, key=lambda d: (d[1], order[d[0]])) if due else None

    def _take_check(self, raw: dict) -> None:
        self.pending_checks[raw["table_id"]] = TableCheck(
            **{
                k: raw[k]
                for k in ("people_present", "state", "items", "reason", "model", "prompt_version")
            },
            checked_at=self.sim_at(raw["t"]),
        )

    def _take_sample(self, sample: dict) -> None:
        at = self.sim_at(sample["t"])
        for table_id, (_shown, raw, seated, flags) in sample["tables"].items():
            ev = FrameEvidence(VisualStatus(raw), seated, frozenset(flags), ())
            summary = self.summarizers[table_id].add(at, sample["t"], ev)
            if summary is not None:
                self._ingest(summary)

    def _say(self, t: float, kind: str, text: str) -> None:
        self.narration.append({"t": round(t, 2), "kind": kind, "text": text})
        del self.narration[:-MAX_NARRATION]

    def _run_step(self, step: "Step") -> None:
        try:
            text = step.run(self)
        except DomainError as err:
            text = None
            self._say(step.t, "autopilot", f"Autopilot skipped a step: {err.message}")
        if text:
            self._say(step.t, "autopilot", text)

    def _narrate_events(self) -> None:
        events = self.services.ctx.repo.list_events()
        for event in events[self.events_seen :]:
            text = _EVENT_TEXT.get(event.event_type)
            if text is None or event.actor_type != "system" and event.event_type != "party_arrived":
                continue
            if event.actor_id == SETUP.actor_id:
                continue
            t = (event.event_time - self.clock.start).total_seconds() / DEMO_TIME_SCALE
            self._say(t, _EVENT_KIND.get(event.event_type, "camera"), text(event))
        self.events_seen = len(events)

    # ---- autopilot helpers ----------------------------------------------------------------

    def table_act(self, table_id: str, action: TableAction, actor: Actor) -> None:
        session = self.services.ctx.repo.get_session(table_id)
        self.services.tables.act(
            table_id,
            TableActionRequest(action=action, expected_version=session.state_version),
            actor,
            f"{self.id}-auto-{table_id}-{action.value}-{session.state_version}",
        )

    def task_act(self, table_id: str, action: TaskAction, actor: Actor) -> None:
        session = self.services.ctx.repo.get_session(table_id)
        task = self.services.ctx.repo.find_open_task(session.session_id)
        if task is None:
            raise InvalidTransition(f"No clearing task on {table_id}.")
        self.services.tasks.act(
            task.task_id,
            TaskActionRequest(action=action),
            actor,
            f"{self.id}-auto-{task.task_id}-{action.value}",
        )

    def seat(self, code: str, table_id: str, reason: str) -> SeatingHold:
        party = next(p for p in self.services.ctx.repo.list_parties() if p.queue_code == code)
        session = self.services.ctx.repo.get_session(table_id)
        request = CreateHoldRequest(
            party_id=party.party_id,
            table_id=table_id,
            party_version=party.version,
            table_version=session.state_version,
        )
        try:
            held = self.services.seating.create_hold(request, HOST, f"{self.id}-hold-{code}")
        except InvalidTransition as err:
            if err.code != "override_reason_required":
                raise
            request = request.model_copy(update={"override_reason": reason})
            held = self.services.seating.create_hold(request, HOST, f"{self.id}-hold-{code}-o")
        return held.hold

    def confirm(self, code: str) -> None:
        party = next(p for p in self.services.ctx.repo.list_parties() if p.queue_code == code)
        hold = next(
            h for h in self.services.ctx.repo.list_active_holds() if h.party_id == party.party_id
        )
        self.services.seating.act(
            hold.hold_id,
            HoldActionRequest(action=HoldAction.CONFIRM, expected_version=hold.version),
            HOST,
            f"{self.id}-seat-{code}",
        )

    def _ingest(self, s) -> None:
        self.seq += 1
        check = self.pending_checks.pop(s.table_id, None)
        try:
            self._submit(s, check)
        except DomainError:
            pass  # e.g. an interval that began before a staff reset: rejected, as live would be

    def _submit(self, s, check) -> None:
        tl = timeline()
        self.services.observations.ingest(
            ObservationSubmission(
                observation_id=f"{self.stream}-{self.seq}",
                frame_id=f"{self.stream}-{s.media_offset_s:.2f}",
                outlet_id=DEMO_OUTLET_ID,
                camera_id=tl.manifest.camera_id,
                table_id=s.table_id,
                configuration_version=tl.manifest.configuration_version,
                stream_id=self.stream,
                gateway_sequence=self.seq,
                interval_started_at=s.interval_started_at,
                observed_at=s.observed_at,
                continuous_valid_coverage=s.continuous_valid_coverage,
                occupied_seen=s.occupied_seen,
                unclear_seen=s.unclear_seen,
                visual_status=s.visual_status,
                object_flags=s.object_flags,
                occlusion=s.unclear_seen or s.visual_status is VisualStatus.UNCLEAR,
                reason=", ".join(s.reasons)[:300],
                source_mode="replay",
                recording_id="mixkit-4385-timelapse",
                media_offset_s=s.media_offset_s,
                model_version=tl.detector,
                policy_version="evidence-v1",
                prompt_version=check.prompt_version if check else None,
                table_check=check,
            ),
            None,
        )


def _seed(ctx: Context, manifest: CameraManifest) -> None:
    now = ctx.clock.now()
    with ctx.repo.transaction():
        for table_id, capacity, attributes, state, minutes in LAYOUT:
            began = now - timedelta(minutes=minutes)
            ctx.repo.put_table(
                Table(
                    outlet_id=ctx.repo.outlet_id,
                    table_id=table_id,
                    capacity=capacity,
                    zone="Dining room",
                    attributes=attributes,
                    camera_id=None,
                    region=None,
                    configuration_version=1,
                    blocked=False,
                )
            )
            occupied = state is OperationalState.OCCUPIED
            ctx.repo.put_session(
                TableSession(
                    session_id=f"sess_{table_id}",
                    table_id=table_id,
                    party_id=f"party-{table_id}-earlier" if occupied else None,
                    operational_state=state,
                    state_version=1,
                    last_valid_observation_at=None,
                    seated_at=began if occupied else None,
                    departed_at=None if occupied else began - timedelta(minutes=8),
                    ready_at=began if state is OperationalState.READY else None,
                )
            )
            record_event(
                ctx,
                event_type="state_initialized",
                actor=SETUP,
                table_id=table_id,
                session_id=f"sess_{table_id}",
                reason=f"Demo start: {state.value}",
            )
    sync_manifests(ctx, [manifest])


class DemoRegistry:
    def __init__(self) -> None:
        self._sessions: OrderedDict[str, DemoSession] = OrderedDict()
        self._lock = threading.Lock()

    def create(self, mode: str = "guided") -> DemoSession:
        with self._lock:
            self._expire()
            while len(self._sessions) >= MAX_SESSIONS:
                self._sessions.popitem(last=False)
            session = DemoSession(mode)
            self._sessions[session.id] = session
            return session

    def get(self, session_id: str | None) -> DemoSession | None:
        with self._lock:
            session = self._sessions.get(session_id or "")
            if session is not None:
                session.touched = time.monotonic()
                self._sessions.move_to_end(session.id)
            return session

    def _expire(self) -> None:
        cutoff = time.monotonic() - IDLE_EXPIRY_S
        for sid in [s for s, v in self._sessions.items() if v.touched < cutoff]:
            del self._sessions[sid]


registry = DemoRegistry()


# ---- autopilot -------------------------------------------------------------------------------
# Autoplay walkthrough: staff and host actions timed to what the footage shows, performed through
# the same rules and permissions a person would use. Each step returns its narration line, or
# None when it no longer applies (for example the viewer already did it).


class Step:
    def __init__(self, t: float, run) -> None:
        self.t = t
        self.run = run


def _state(session: "DemoSession", table_id: str) -> OperationalState:
    return session.services.ctx.repo.get_session(table_id).operational_state


def _confirm_t3(s: "DemoSession") -> str | None:
    if _state(s, "T3") is not OperationalState.OCCUPIED:
        return None
    s.table_act("T3", TableAction.CONFIRM_DEPARTURE, STAFF)
    return "T3's guests are leaving. Ana confirms the departure; a clearing task opens."


def _clear(table_id: str):
    def run(s: "DemoSession") -> str | None:
        if _state(s, table_id) is not OperationalState.NEEDS_CLEARING:
            return None
        s.task_act(table_id, TaskAction.CLAIM, STAFF)
        s.task_act(table_id, TaskAction.START, STAFF)
        return f"Ana claims {table_id} and starts resetting it."

    return run


def _ready(table_id: str):
    def run(s: "DemoSession") -> str | None:
        if _state(s, table_id) is not OperationalState.CLEANING:
            return None
        s.table_act(table_id, TableAction.MARK_READY, STAFF)
        return f"{table_id} is reset. Ana marks it Ready, so the host can seat it."

    return run


def _hold(code: str, table_id: str, reason: str, line: str):
    def run(s: "DemoSession") -> str | None:
        party = next((p for p in s.services.ctx.repo.list_parties() if p.queue_code == code), None)
        if party is None or party.status is not PartyStatus.WAITING:
            return None
        if _state(s, table_id) is not OperationalState.READY:
            return None
        hold = s.seat(code, table_id, reason)
        return line + (" (host override: " + reason + ")" if hold.override_reason else "")

    return run


def _seated(code: str, table_id: str):
    def run(s: "DemoSession") -> str | None:
        party = next((p for p in s.services.ctx.repo.list_parties() if p.queue_code == code), None)
        if party is None or party.status is not PartyStatus.ON_HOLD:
            return None
        s.confirm(code)
        return f"{code} sits down at {table_id}. A new occupied session starts."

    return run


def _confirm_t2(s: "DemoSession") -> str | None:
    if _state(s, "T2") is not OperationalState.DEPARTURE_REVIEW:
        return None
    s.table_act("T2", TableAction.CONFIRM_DEPARTURE, STAFF)
    return "Ana checks T2 after the camera's prompt and confirms the guests have left."


def _check_t4(s: "DemoSession") -> str | None:
    return "Ana looks at T4: the glasses Gemini flagged are the clean place setting."


AUTOPILOT = [
    Step(2.95, _confirm_t3),
    Step(3.25, _clear("T3")),
    Step(3.9, _ready("T3")),
    Step(
        4.1,
        _hold(
            "W1",
            "T3",
            "Host is walking W1 to T3 now",
            "The host holds T3 for W1, the oldest party that fits.",
        ),
    ),
    Step(4.12, _seated("W1", "T3")),  # before the camera sees them sit (that would cancel the hold)
    Step(7.65, _confirm_t2),
    Step(7.9, _clear("T2")),
    Step(8.0, _check_t4),
    Step(
        8.15,
        _hold(
            "W2",
            "T4",
            "Ana checked T4: glasses are the clean setting",
            "The host holds T4, the only six-seat table, for W2.",
        ),
    ),
    Step(8.3, _seated("W2", "T4")),
    Step(8.6, _ready("T2")),
]

_EVENT_TEXT = {
    "party_arrived": lambda e: f"Walk-in at the host stand: {e.reason}.",
    "departure_review_requested": lambda e: (
        f"Camera: {e.table_id} has looked empty for 30 s, so TurnWise asks staff to check it."
    ),
    "departure_review_withdrawn": lambda e: (
        f"Camera: someone is at {e.table_id} again, so the check is withdrawn."
    ),
    "occupancy_on_ready_table": lambda e: (
        f"Camera: someone is at {e.table_id}, which is marked "
        "ready. Seating there pauses until it is verified."
    ),
    "ready_table_leftovers_seen": lambda e: (
        f"Gemini: {e.table_id} is marked ready but still "
        f"has {_gemini_items(e.reason)} on it. Staff should check before anyone is seated."
    ),
    "seating_hold_expired": lambda e: (
        f"The hold on {e.table_id} expired; the party keeps its place in the queue."
    ),
}


def _gemini_items(reason: str | None) -> str:
    # reason format: "Gemini (<model>) sees <items>: <explanation>"
    return (reason or "").partition(" sees ")[2].partition(":")[0] or "items"


_EVENT_KIND = {
    "party_arrived": "arrival",
    "ready_table_leftovers_seen": "gemini",
    "seating_hold_expired": "rules",
}
