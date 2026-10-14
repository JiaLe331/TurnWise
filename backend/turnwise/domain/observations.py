import hashlib
from datetime import timedelta

from turnwise.contracts import (
    Actor,
    ActorType,
    CameraState,
    Observation,
    ObservationSubmission,
    OperationalState,
    TableBoardEntry,
    TableSession,
    VisualStatus,
)
from turnwise.domain.context import Context, entry_for, record_event, run_idempotent, transition
from turnwise.domain.errors import BadRequest, Forbidden, InvalidTransition, NotFound
from turnwise.domain.evidence import is_stale
from turnwise.domain.roles import require

VACANCY_REQUIRED = timedelta(seconds=30)
COVERAGE_GAP = timedelta(seconds=2)
FUTURE_SKEW = timedelta(seconds=5)
MAX_AGE = timedelta(minutes=10)  # PRD retry buffer
RETIRED_STREAMS_KEPT = 20
OBSERVER = Actor(actor_id="vision-observer", actor_type=ActorType.SYSTEM)


class ObservationRejected(InvalidTransition):
    code = "observation_rejected"


def reset_vacancy(ctx: Context, table_id: str) -> None:
    """Staff decisions (dismissal, override, departure) invalidate earlier vacancy evidence."""
    state = ctx.repo.get_camera_state(table_id)
    if state is None:
        return
    state.vacant_since = None
    state.review_version = None
    state.table_check = None
    state.reset_at = ctx.clock.now()
    ctx.repo.put_camera_state(state)


class ObservationOperations:
    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx

    def ingest(self, sub: ObservationSubmission, camera_scope: str | None) -> TableBoardEntry:
        if camera_scope is not None and camera_scope != sub.camera_id:
            raise Forbidden("Credential is not scoped to this camera.", code="camera_not_allowed")
        digest = hashlib.sha256(sub.model_dump_json().encode()).hexdigest()
        return run_idempotent(
            self.ctx,
            f"observation:{sub.observation_id}",
            f"observation:{digest}",
            lambda: self._apply(sub),
        )

    def _apply(self, sub: ObservationSubmission) -> TableBoardEntry:
        now = self.ctx.clock.now()
        table = self.ctx.repo.get_table(sub.table_id)
        session = self.ctx.repo.get_session(sub.table_id)
        if sub.outlet_id != self.ctx.repo.outlet_id or table is None or session is None:
            raise NotFound(f"Table {sub.outlet_id}/{sub.table_id} does not exist.")
        if table.camera_id != sub.camera_id:
            raise Forbidden(f"{sub.camera_id} is not mapped to {sub.table_id}.", code="unmapped")
        if sub.configuration_version != table.configuration_version:
            raise ObservationRejected("Camera mapping version changed; recalibrate.")
        if sub.interval_started_at > sub.observed_at:
            raise BadRequest("interval_started_at is after observed_at.")
        if sub.observed_at > now + FUTURE_SKEW:
            raise BadRequest("observed_at is in the future.", code="clock_skew")
        if sub.observed_at < now - MAX_AGE:
            raise ObservationRejected("Observation is older than the retry buffer.")

        state = self.ctx.repo.get_camera_state(sub.table_id) or CameraState(
            table_id=sub.table_id, camera_id=sub.camera_id
        )
        continuous = sub.stream_id == state.stream_id
        if sub.stream_id in state.retired_streams:
            raise ObservationRejected(f"Stream {sub.stream_id} was replaced by a newer run.")
        if continuous and sub.gateway_sequence <= state.last_sequence:
            raise ObservationRejected("Sequence is not newer than the last accepted one.")
        if state.reset_at is not None and sub.interval_started_at < state.reset_at:
            raise ObservationRejected("Interval started before a staff reset.")
        if not continuous:
            if state.stream_id is not None:
                state.retired_streams = [*state.retired_streams, state.stream_id][
                    -RETIRED_STREAMS_KEPT:
                ]
            state.stream_id = sub.stream_id
            state.vacant_since = None

        observation = Observation(
            **sub.model_dump(), received_at=now, session_id=session.session_id
        )
        self.ctx.repo.append_observation(observation)

        valid = (
            sub.continuous_valid_coverage
            and not sub.unclear_seen
            and not sub.occlusion
            and sub.visual_status is not VisualStatus.UNCLEAR
        )
        vacant = valid and not sub.occupied_seen and sub.visual_status is VisualStatus.VACANT
        gap = (
            not continuous
            or state.last_observed_at is None
            or sub.interval_started_at - state.last_observed_at > COVERAGE_GAP
        )
        if not vacant:
            state.vacant_since = None
        elif gap or state.vacant_since is None:
            state.vacant_since = sub.interval_started_at

        previous = state.latest
        state.last_sequence = sub.gateway_sequence
        state.last_observed_at = sub.observed_at
        state.stale_recorded = False
        state.latest = observation
        if valid:
            # Not a state transition: evidence freshness must not bump state_version.
            session.last_valid_observation_at = sub.observed_at
            self.ctx.repo.put_session(session)

        self._apply_rules(state, session, observation, valid, previous)
        self._apply_table_check(state, session, sub, now)
        self.ctx.repo.put_camera_state(state)
        return entry_for(self.ctx, sub.table_id)

    def _apply_rules(
        self,
        state: CameraState,
        session: TableSession,
        obs: Observation,
        valid: bool,
        previous: Observation | None,
    ) -> None:
        table = self.ctx.repo.get_table(session.table_id)
        assert table is not None
        op = session.operational_state
        if (
            op is OperationalState.OCCUPIED
            and not session.manual
            and not table.blocked
            and state.vacant_since is not None
            and obs.observed_at - state.vacant_since >= VACANCY_REQUIRED
        ):
            require(OBSERVER, "request_departure_review")
            transition(session, OperationalState.DEPARTURE_REVIEW)
            self.ctx.repo.put_session(session)
            state.review_version = session.state_version
            seconds = int((obs.observed_at - state.vacant_since).total_seconds())
            self._event(
                session, "departure_review_requested", obs, f"No seated guests for {seconds}s"
            )
        elif (
            op is OperationalState.DEPARTURE_REVIEW
            and state.review_version == session.state_version
            and valid
            and obs.occupied_seen
        ):
            require(OBSERVER, "withdraw_observation_review")
            transition(session, OperationalState.OCCUPIED)
            self.ctx.repo.put_session(session)
            state.review_version = None
            self._event(session, "departure_review_withdrawn", obs, "Guests seen again")
        elif (
            op is OperationalState.READY
            and valid
            and obs.occupied_seen
            and not (previous is not None and previous.occupied_seen)
        ):
            # Verification blocker for A's recommendation/hold logic; never changes state.
            self._event(session, "occupancy_on_ready_table", obs, "Guests seen at a ready table")

    def _apply_table_check(
        self, state: CameraState, session: TableSession, sub: ObservationSubmission, now
    ) -> None:
        """Gemini's table check is advisory: it is stored as evidence and may raise one
        verification event for a ready table, but never changes operational state."""
        check = sub.table_check
        if check is None or check.checked_at > now + FUTURE_SKEW:
            return
        if state.reset_at is not None and check.checked_at < state.reset_at:
            return  # predates a staff decision
        if state.table_check is not None and check.checked_at <= state.table_check.checked_at:
            return
        state.table_check = check
        if (
            session.operational_state is OperationalState.READY
            and check.state == "leftovers"
            and not check.people_present
            and (session.ready_at is None or check.checked_at >= session.ready_at)
            and state.alerted_check_at != check.checked_at
        ):
            state.alerted_check_at = check.checked_at
            items = ", ".join(check.items) or "items"
            record_event(
                self.ctx,
                event_type="ready_table_leftovers_seen",
                actor=OBSERVER,
                table_id=session.table_id,
                session_id=session.session_id,
                reason=f"Gemini ({check.model}) sees {items}: {check.reason}"[:300],
            )

    def _event(self, session: TableSession, kind: str, obs: Observation, why: str) -> None:
        record_event(
            self.ctx,
            event_type=kind,
            actor=OBSERVER,
            table_id=session.table_id,
            session_id=session.session_id,
            party_id=session.party_id,
            reason=f"{why} ({obs.camera_id}, {obs.source_mode}, {obs.model_version})",
        )

    def sweep_stale(self) -> int:
        """Record camera_stale once per outage. Call periodically."""
        now = self.ctx.clock.now()
        recorded = 0
        with self.ctx.repo.transaction():
            for state in self.ctx.repo.list_camera_states():
                if state.stale_recorded or state.last_observed_at is None:
                    continue
                if not is_stale(state, now):
                    continue
                state.stale_recorded = True
                state.vacant_since = None
                self.ctx.repo.put_camera_state(state)
                session = self.ctx.repo.get_session(state.table_id)
                record_event(
                    self.ctx,
                    event_type="camera_stale",
                    actor=OBSERVER,
                    table_id=state.table_id,
                    session_id=session.session_id if session else None,
                    reason=f"No observation from {state.camera_id} for over 60s",
                )
                recorded += 1
        return recorded
