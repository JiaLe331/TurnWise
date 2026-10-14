"""FR07/FR08: table eligibility, recommendations and 60-second seating holds."""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta

from turnwise.contracts import (
    Actor,
    ActorType,
    CreateHoldRequest,
    HoldAction,
    HoldActionRequest,
    HoldStatus,
    OperationalState,
    PartyStatus,
    QueueParty,
    QueueSkip,
    Recommendation,
    SeatingHold,
    SeatingResult,
    Table,
    TableOption,
    TableSession,
    VisualStatus,
)
from turnwise.domain.context import (
    Context,
    entry_for,
    new_id,
    record_event,
    require_reason,
    run_idempotent,
    transition,
)
from turnwise.domain.errors import InvalidTransition, NotFound, VersionConflict
from turnwise.domain.evidence import is_stale
from turnwise.domain.observations import reset_vacancy
from turnwise.domain.roles import require

HOLD_TTL = timedelta(seconds=60)
HOLD_TIMER = Actor(actor_id="seating-timer", actor_type=ActorType.SYSTEM)
MAX_OPTIONS = 3
ACTIVE_PARTY = frozenset({PartyStatus.WAITING, PartyStatus.ON_HOLD})


def fingerprint(prefix: str, payload) -> str:
    return f"{prefix}:{hashlib.sha256(payload.model_dump_json().encode()).hexdigest()}"


def active_queue(ctx: Context) -> list[QueueParty]:
    """Waiting and held parties in stable arrival order (insertion order breaks ties)."""
    parties = [p for p in ctx.repo.list_parties() if p.status in ACTIVE_PARTY]
    return sorted(parties, key=lambda p: p.arrival_at)


def unsuitable(table: Table, party: QueueParty) -> str | None:
    """Why this table can never serve this party right now (hard, not overridable)."""
    if table.blocked:
        return "blocked"
    if table.capacity < party.size:
        return f"seats {table.capacity}, party of {party.size}"
    missing = sorted(set(party.requirements) - set(table.attributes))
    if missing:
        return f"not {', '.join(missing)}"
    return None


@dataclass(frozen=True)
class Availability:
    unavailable: str | None  # hard: never seat here now
    unverified: str | None  # soft: host may override after a physical check
    evidence: str  # "camera" or "manual"


def availability(
    ctx: Context,
    table: Table,
    session: TableSession,
    holds: list[SeatingHold],
    *,
    ignore_hold: str | None = None,
) -> Availability:
    evidence = "camera" if table.camera_id else "manual"
    if session.operational_state is not OperationalState.READY:
        return Availability(f"is {session.operational_state.value}", None, evidence)
    if session.party_id is not None:
        return Availability("has an active party", None, evidence)
    if any(h.table_id == table.table_id and h.hold_id != ignore_hold for h in holds):
        return Availability("is held for another party", None, evidence)
    if table.camera_id is None:
        # Unmapped tables stay manually managed: staff Ready confirmation is the verification.
        return Availability(None, None, evidence)
    state = ctx.repo.get_camera_state(table.table_id)
    if state is None or is_stale(state, ctx.clock.now()):
        return Availability(None, "has no current camera evidence", evidence)
    latest = state.latest
    if latest is not None and (
        latest.occupied_seen or latest.visual_status is VisualStatus.OCCUPIED
    ):
        return Availability(None, "shows guests on camera", evidence)
    return Availability(None, None, evidence)


def _option(table: Table, session: TableSession, party: QueueParty, kind: str, now) -> TableOption:
    ready = ""
    if session.ready_at is not None:
        ready = f"ready {int((now - session.ready_at).total_seconds() // 60)} min, "
    proof = "camera clear" if kind == "camera" else "staff-confirmed, no camera"
    return TableOption(
        table_id=table.table_id,
        capacity=table.capacity,
        zone=table.zone,
        attributes=table.attributes,
        table_version=session.state_version,
        ready_at=session.ready_at,
        evidence=kind,
        reason=f"{table.table_id}: {ready}seats {table.capacity} for party of {party.size}, "
        f"{proof}",
    )


class SeatingOperations:
    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx

    # ---- recommendations -------------------------------------------------------------

    def _tables(self) -> list[tuple[Table, TableSession]]:
        out = []
        for table in self.ctx.repo.list_tables():
            session = self.ctx.repo.get_session(table.table_id)
            if session is not None:
                out.append((table, session))
        return out

    def _options(self, party, tables, holds) -> tuple[list[TableOption], str]:
        now = self.ctx.clock.now()
        options: list[tuple[Table, TableSession, str]] = []
        why: list[str] = []
        for table, session in tables:
            avail = availability(self.ctx, table, session, holds)
            if avail.unavailable:
                continue
            problem = unsuitable(table, party)
            if problem:
                why.append(problem)
            elif avail.unverified:
                why.append(f"{table.table_id} {avail.unverified}")
            else:
                options.append((table, session, avail.evidence))
        # Smallest suitable table, then longest ready, then table id.
        options.sort(
            key=lambda o: (o[0].capacity, o[1].ready_at or now, o[0].table_id),
        )
        reason = "; ".join(sorted(set(why))[:3]) if why else "no table is ready"
        return [_option(t, s, party, k, now) for t, s, k in options[:MAX_OPTIONS]], reason

    def recommend(self, party_id: str | None = None) -> Recommendation:
        self.sweep()
        now = self.ctx.clock.now()
        tables = self._tables()
        holds = self.ctx.repo.list_active_holds()
        waiting = [p for p in active_queue(self.ctx) if p.status is PartyStatus.WAITING]
        if party_id is not None:
            waiting = [p for p in waiting if p.party_id == party_id]
            if not waiting:
                raise NotFound(f"Party {party_id} is not waiting.")
        skipped: list[QueueSkip] = []
        for party in waiting:
            options, reason = self._options(party, tables, holds)
            if options:
                message = f"Seat {party.queue_code} (party of {party.size})"
                if skipped:
                    message += (
                        f"; {len(skipped)} earlier part{'y' if len(skipped) == 1 else 'ies'} "
                    )
                    message += "cannot be seated yet"
                return Recommendation(
                    generated_at=now,
                    party=party,
                    tables=options,
                    skipped=skipped,
                    message=message,
                )
            skipped.append(
                QueueSkip(party_id=party.party_id, queue_code=party.queue_code, reason=reason)
            )
        message = "No waiting parties." if not waiting else "No ready table fits a waiting party."
        return Recommendation(
            generated_at=now, party=None, tables=[], skipped=skipped, message=message
        )

    # ---- holds -----------------------------------------------------------------------

    def create_hold(self, req: CreateHoldRequest, actor: Actor, key: str) -> SeatingResult:
        require(actor, "create_hold")
        self.sweep()

        def apply() -> SeatingResult:
            now = self.ctx.clock.now()
            party = self._party(req.party_id)
            if party.status is not PartyStatus.WAITING:
                raise InvalidTransition(
                    f"Party {party.queue_code} is {party.status.value}.", code="party_not_waiting"
                )
            if party.version != req.party_version:
                raise VersionConflict("The waitlist changed. Refresh the recommendation.")
            entry = entry_for(self.ctx, req.table_id)
            table, session = entry.table, entry.session
            if session.state_version != req.table_version:
                raise VersionConflict(
                    f"Table {table.table_id} changed since the recommendation. Refresh."
                )
            holds = self.ctx.repo.list_active_holds()
            avail = availability(self.ctx, table, session, holds)
            if avail.unavailable:
                raise InvalidTransition(
                    f"Table {table.table_id} {avail.unavailable}.", code="table_unavailable"
                )
            problem = unsuitable(table, party)
            if problem:
                raise InvalidTransition(
                    f"Table {table.table_id} {problem}.", code="table_unsuitable"
                )
            overrides = []
            if avail.unverified:
                overrides.append(f"{table.table_id} {avail.unverified}")
            older = next(
                (
                    p
                    for p in active_queue(self.ctx)
                    if p.status is PartyStatus.WAITING
                    and p.arrival_at < party.arrival_at
                    and unsuitable(table, p) is None
                ),
                None,
            )
            if older is not None:
                overrides.append(f"skips waiting party {older.queue_code}")
            reason = None
            if overrides:
                if not (req.override_reason and req.override_reason.strip()):
                    raise InvalidTransition(
                        "Host override reason required: " + "; ".join(overrides) + ".",
                        code="override_reason_required",
                    )
                reason = f"{'; '.join(overrides)}: {req.override_reason.strip()}"
            hold = SeatingHold(
                hold_id=new_id("hold"),
                party_id=party.party_id,
                table_id=table.table_id,
                expires_at=now + HOLD_TTL,
                version=1,
                created_at=now,
                created_by=actor.actor_id,
                table_state_version=session.state_version,
                manual=avail.unverified is not None,
                override_reason=reason,
            )
            party.status = PartyStatus.ON_HOLD
            party.version += 1
            self.ctx.repo.put_hold(hold)
            self.ctx.repo.put_party(party)
            record_event(
                self.ctx,
                event_type="seating_hold_created",
                actor=actor,
                table_id=table.table_id,
                party_id=party.party_id,
                session_id=session.session_id,
                reason=reason,
            )
            return SeatingResult(hold=hold, party=party, table=entry_for(self.ctx, table.table_id))

        return run_idempotent(self.ctx, key, fingerprint("hold:create", req), apply)

    def act(self, hold_id: str, req: HoldActionRequest, actor: Actor, key: str) -> SeatingResult:
        require(actor, f"{req.action.value}_hold")
        self.sweep()  # persist expiry/invalidation before judging this request

        def apply() -> SeatingResult:
            hold = self.ctx.repo.get_hold(hold_id)
            if hold is None:
                raise NotFound(f"Hold {hold_id} does not exist.")
            if hold.status is not HoldStatus.ACTIVE:
                raise InvalidTransition(
                    f"Hold is {hold.status.value}. Refresh the recommendation.",
                    code="hold_not_active",
                )
            if hold.version != req.expected_version:
                raise VersionConflict("Hold changed. Refresh and retry.")
            if req.action is HoldAction.CONFIRM:
                self._confirm(hold, actor)
            else:
                self.release(hold, HoldStatus.CANCELLED, actor, req.reason or "Cancelled by host")
            return SeatingResult(
                hold=self.ctx.repo.get_hold(hold_id),
                party=self._party(hold.party_id),
                table=entry_for(self.ctx, hold.table_id),
            )

        return run_idempotent(self.ctx, key, fingerprint(f"hold:{hold_id}", req), apply)

    def _confirm(self, hold: SeatingHold, actor: Actor) -> None:
        now = self.ctx.clock.now()
        party = self._party(hold.party_id)
        previous = self.ctx.repo.get_session(hold.table_id)
        assert previous is not None
        session = TableSession(
            session_id=new_id("sess"),
            table_id=hold.table_id,
            party_id=party.party_id,
            operational_state=OperationalState.READY,
            state_version=previous.state_version,
            last_valid_observation_at=None,
            seated_at=now,
            departed_at=None,
            ready_at=None,
        )
        transition(session, OperationalState.OCCUPIED)
        self.ctx.repo.put_session(session)
        reset_vacancy(self.ctx, hold.table_id)
        party.status = PartyStatus.SEATED
        party.table_id = hold.table_id
        party.seated_at = now
        party.version += 1
        self.ctx.repo.put_party(party)
        hold.status = HoldStatus.CONFIRMED
        hold.version += 1
        self.ctx.repo.put_hold(hold)
        record_event(
            self.ctx,
            event_type="party_seated",
            actor=actor,
            table_id=hold.table_id,
            party_id=party.party_id,
            session_id=session.session_id,
            reason=f"Manual assignment: {hold.override_reason}" if hold.manual else None,
        )

    def release(self, hold: SeatingHold, status: HoldStatus, actor: Actor, reason: str) -> None:
        """End an active hold; the party returns to its original arrival position."""
        hold.status = status
        hold.version += 1
        self.ctx.repo.put_hold(hold)
        party = self.ctx.repo.get_party(hold.party_id)
        if party is not None and party.status is PartyStatus.ON_HOLD:
            party.status = PartyStatus.WAITING
            party.version += 1
            self.ctx.repo.put_party(party)
        kind = {
            HoldStatus.EXPIRED: "seating_hold_expired",
            HoldStatus.CANCELLED: "seating_hold_cancelled",
        }[status]
        record_event(
            self.ctx,
            event_type=kind,
            actor=actor,
            table_id=hold.table_id,
            party_id=hold.party_id,
            reason=require_reason(reason),
            source="system" if actor.actor_type is ActorType.SYSTEM else None,
        )

    def problem(self, hold: SeatingHold, now: datetime) -> str | None:
        if now > hold.expires_at:
            return "Hold expired after 60 seconds"
        table = self.ctx.repo.get_table(hold.table_id)
        session = self.ctx.repo.get_session(hold.table_id)
        if table is None or session is None:
            return "Table no longer exists"
        if table.blocked:
            return "Table was blocked"
        if session.state_version != hold.table_state_version:
            return "Table state changed; host verification needed"
        state = self.ctx.repo.get_camera_state(hold.table_id) if table.camera_id else None
        latest = state.latest if state else None
        if (
            latest is not None
            and latest.observed_at > hold.created_at
            and (latest.occupied_seen or latest.visual_status is VisualStatus.OCCUPIED)
        ):
            return "Guests seen at the held table; host verification needed"
        return None

    def sweep(self) -> int:
        """Expire or invalidate holds. Runs before every seating decision and periodically."""
        now = self.ctx.clock.now()
        ended = 0
        with self.ctx.repo.transaction():
            for hold in self.ctx.repo.list_active_holds():
                problem = self.problem(hold, now)
                if problem is None:
                    continue
                status = HoldStatus.EXPIRED if now > hold.expires_at else HoldStatus.CANCELLED
                self.release(hold, status, HOLD_TIMER, problem)
                ended += 1
        return ended

    def _party(self, party_id: str) -> QueueParty:
        party = self.ctx.repo.get_party(party_id)
        if party is None:
            raise NotFound(f"Party {party_id} does not exist.")
        return party
