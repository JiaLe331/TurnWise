from turnwise.contracts import (
    Actor,
    OperationalState,
    TableAction,
    TableActionRequest,
    TableBoardEntry,
    TableSession,
)
from turnwise.domain.context import (
    Context,
    check_version,
    entry_for,
    record_event,
    require_reason,
    run_idempotent,
    transition,
)
from turnwise.domain.errors import BadRequest, InvalidTransition, NotFound
from turnwise.domain.roles import require
from turnwise.domain.tasks import TaskOperations

VERSIONED_ACTIONS = frozenset(
    {
        TableAction.REQUEST_DEPARTURE_REVIEW,
        TableAction.DISMISS_REVIEW,
        TableAction.CONFIRM_DEPARTURE,
        TableAction.MARK_READY,
        TableAction.OVERRIDE_STATE,
        TableAction.RELEASE_OVERRIDE,
    },
)
OVERRIDE_TARGETS = frozenset(
    {
        OperationalState.OCCUPIED,
        OperationalState.DEPARTURE_REVIEW,
        OperationalState.NEEDS_CLEARING,
        OperationalState.READY,
    },
)


class TableOperations:
    def __init__(self, ctx: Context, tasks: TaskOperations) -> None:
        self.ctx = ctx
        self.tasks = tasks

    def act(
        self,
        table_id: str,
        request: TableActionRequest,
        actor: Actor,
        idempotency_key: str,
    ) -> TableBoardEntry:
        require(actor, request.action.value)
        if request.action in VERSIONED_ACTIONS and request.expected_version is None:
            raise BadRequest("expected_version is required.", code="expected_version_required")

        def apply() -> TableBoardEntry:
            entry = entry_for(self.ctx, table_id)
            session = entry.session
            if request.action in VERSIONED_ACTIONS:
                check_version(session, request.expected_version)
            handlers = {
                TableAction.REQUEST_DEPARTURE_REVIEW: lambda: self._request_review(session, actor),
                TableAction.DISMISS_REVIEW: lambda: self._dismiss_review(session, actor),
                TableAction.CONFIRM_DEPARTURE: lambda: self._confirm_departure(session, actor),
                TableAction.MARK_READY: lambda: self._mark_ready(session, actor),
                TableAction.OVERRIDE_STATE: lambda: self._override(session, actor, request),
                TableAction.RELEASE_OVERRIDE: lambda: self._release_override(session, actor),
                TableAction.BLOCK: lambda: self._set_blocked(table_id, True, actor, request),
                TableAction.UNBLOCK: lambda: self._set_blocked(table_id, False, actor, request),
            }
            handlers[request.action]()
            return entry_for(self.ctx, table_id)

        return run_idempotent(
            self.ctx,
            idempotency_key,
            f"table:{table_id}:{request.action.value}",
            apply,
        )

    def _expect(self, session: TableSession, *allowed: OperationalState) -> None:
        if session.operational_state not in allowed:
            raise InvalidTransition(
                f"Table {session.table_id} is {session.operational_state.value}; "
                f"expected {' or '.join(s.value for s in allowed)}.",
            )

    def _save(self, session: TableSession) -> None:
        self.ctx.repo.put_session(session)

    def _request_review(self, session: TableSession, actor: Actor) -> None:
        self._expect(session, OperationalState.OCCUPIED)
        transition(session, OperationalState.DEPARTURE_REVIEW)
        self._save(session)
        record_event(
            self.ctx,
            event_type="departure_review_requested",
            actor=actor,
            table_id=session.table_id,
            session_id=session.session_id,
            party_id=session.party_id,
        )

    def _dismiss_review(self, session: TableSession, actor: Actor) -> None:
        self._expect(session, OperationalState.DEPARTURE_REVIEW)
        transition(session, OperationalState.OCCUPIED)
        self._save(session)
        record_event(
            self.ctx,
            event_type="departure_review_dismissed",
            actor=actor,
            table_id=session.table_id,
            session_id=session.session_id,
            party_id=session.party_id,
        )

    def _confirm_departure(self, session: TableSession, actor: Actor) -> None:
        self._expect(session, OperationalState.OCCUPIED, OperationalState.DEPARTURE_REVIEW)
        party_id = session.party_id
        session.party_id = None
        session.manual = False
        session.departed_at = self.ctx.clock.now()
        transition(session, OperationalState.NEEDS_CLEARING)
        self._save(session)
        self.tasks.create_for_session(session)
        record_event(
            self.ctx,
            event_type="departure_confirmed",
            actor=actor,
            table_id=session.table_id,
            session_id=session.session_id,
            party_id=party_id,
        )
        if party_id is not None:
            record_event(
                self.ctx,
                event_type="party_left",
                actor=actor,
                table_id=session.table_id,
                session_id=session.session_id,
                party_id=party_id,
            )

    def _mark_ready(self, session: TableSession, actor: Actor) -> None:
        self._expect(session, OperationalState.CLEANING)
        task = self.ctx.repo.find_open_task(session.session_id)
        if task is None:
            raise InvalidTransition("No active clearing task for this table.", code="no_task")
        self.tasks.complete(task, session, actor)

    def _override(self, session: TableSession, actor: Actor, request: TableActionRequest) -> None:
        reason = require_reason(request.reason)
        target = request.target_state
        if target not in OVERRIDE_TARGETS:
            raise InvalidTransition(
                "Override target must be occupied, departure_review, needs_clearing or ready.",
                code="override_target_not_allowed",
            )
        previous = session.operational_state
        if previous is target:
            raise InvalidTransition(f"Table {session.table_id} is already {target.value}.")
        self.tasks.cancel_open_task(session, actor, f"State overridden: {reason}")
        now = self.ctx.clock.now()
        session.manual = True
        if target is OperationalState.READY:
            session.ready_at = now
        if target is OperationalState.NEEDS_CLEARING and session.departed_at is None:
            session.departed_at = now
        if target is OperationalState.OCCUPIED:
            session.departed_at = None
            session.ready_at = None
        transition(session, target)
        self._save(session)
        if target is OperationalState.NEEDS_CLEARING:
            self.tasks.create_for_session(session)
        record_event(
            self.ctx,
            event_type="state_overridden",
            actor=actor,
            table_id=session.table_id,
            session_id=session.session_id,
            party_id=session.party_id,
            reason=f"{previous.value} -> {target.value}: {reason}",
        )

    def _release_override(self, session: TableSession, actor: Actor) -> None:
        if not session.manual:
            raise InvalidTransition("Table has no manual override to release.")
        session.manual = False
        session.state_version += 1
        self._save(session)
        record_event(
            self.ctx,
            event_type="override_released",
            actor=actor,
            table_id=session.table_id,
            session_id=session.session_id,
        )

    def _set_blocked(
        self,
        table_id: str,
        blocked: bool,
        actor: Actor,
        request: TableActionRequest,
    ) -> None:
        reason = require_reason(request.reason) if blocked else request.reason
        table = self.ctx.repo.get_table(table_id)
        if table is None:
            raise NotFound(f"Table {table_id} does not exist.")
        if table.blocked is blocked:
            state = "blocked" if blocked else "unblocked"
            raise InvalidTransition(f"Table {table_id} is already {state}.")
        table.blocked = blocked
        self.ctx.repo.put_table(table)
        record_event(
            self.ctx,
            event_type="table_blocked" if blocked else "table_unblocked",
            actor=actor,
            table_id=table_id,
            reason=reason,
        )
