from turnwise.contracts import (
    Actor,
    ClearingTask,
    OperationalState,
    TableBoardEntry,
    TableSession,
    TaskAction,
    TaskActionRequest,
    TaskStatus,
)
from turnwise.domain.context import (
    Context,
    check_version,
    entry_for,
    new_id,
    record_event,
    require_reason,
    run_idempotent,
    transition,
)
from turnwise.domain.errors import Forbidden, InvalidTransition, NotFound
from turnwise.domain.repository import OPEN_TASK_STATUSES
from turnwise.domain.roles import is_manager, require

DEFAULT_PRIORITY_REASON = "Oldest confirmed departure first"


class TaskOperations:
    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx

    def create_for_session(
        self,
        session: TableSession,
        reason: str = DEFAULT_PRIORITY_REASON,
    ) -> ClearingTask:
        existing = self.ctx.repo.find_open_task(session.session_id)
        if existing is not None:
            return existing
        task = ClearingTask(
            task_id=new_id("task"),
            session_id=session.session_id,
            table_id=session.table_id,
            status=TaskStatus.UNASSIGNED,
            priority_reason=reason,
            owner_id=None,
            created_at=self.ctx.clock.now(),
            started_at=None,
            completed_at=None,
        )
        self.ctx.repo.put_task(task)
        return task

    def cancel_open_task(self, session: TableSession, actor: Actor, reason: str) -> None:
        task = self.ctx.repo.find_open_task(session.session_id)
        if task is None:
            return
        task.status = TaskStatus.CANCELLED
        self.ctx.repo.put_task(task)
        record_event(
            self.ctx,
            event_type="task_cancelled",
            actor=actor,
            table_id=session.table_id,
            session_id=session.session_id,
            reason=reason,
        )

    def act(
        self,
        task_id: str,
        request: TaskActionRequest,
        actor: Actor,
        idempotency_key: str,
    ) -> TableBoardEntry:
        require(actor, f"{request.action.value}_task")

        def apply() -> TableBoardEntry:
            task = self._load(task_id)
            session = self._session_for(task)
            check_version(session, request.expected_version)
            handlers = {
                TaskAction.CLAIM: lambda: self._claim(task, actor),
                TaskAction.START: lambda: self._start(task, session, actor),
                TaskAction.RELEASE: lambda: self._release(task, session, actor),
                TaskAction.COMPLETE: lambda: self.complete(task, session, actor),
                TaskAction.CANCEL: lambda: self._cancel(task, session, actor, request.reason),
            }
            handlers[request.action]()
            return entry_for(self.ctx, task.table_id)

        return run_idempotent(
            self.ctx,
            idempotency_key,
            f"task:{task_id}:{request.action.value}",
            apply,
        )

    def complete(self, task: ClearingTask, session: TableSession, actor: Actor) -> None:
        self._require_owner(task, actor)
        if task.status is not TaskStatus.STARTED or (
            session.operational_state is not OperationalState.CLEANING
        ):
            raise InvalidTransition(
                "Only a started task on a cleaning table can be completed.",
                code="task_not_started",
            )
        now = self.ctx.clock.now()
        task.status = TaskStatus.COMPLETED
        task.completed_at = now
        session.ready_at = now
        transition(session, OperationalState.READY)
        self.ctx.repo.put_task(task)
        self.ctx.repo.put_session(session)
        record_event(
            self.ctx,
            event_type="ready_confirmed",
            actor=actor,
            table_id=task.table_id,
            session_id=session.session_id,
        )

    def _load(self, task_id: str) -> ClearingTask:
        task = self.ctx.repo.get_task(task_id)
        if task is None:
            raise NotFound(f"Task {task_id} does not exist.")
        return task

    def _session_for(self, task: ClearingTask) -> TableSession:
        session = self.ctx.repo.get_session(task.table_id)
        if session is None or session.session_id != task.session_id:
            raise InvalidTransition("This task belongs to an earlier cycle.", code="task_stale")
        return session

    def _require_owner(self, task: ClearingTask, actor: Actor) -> None:
        if not is_manager(actor) and task.owner_id != actor.actor_id:
            raise Forbidden("Only the task owner or a manager can do this.", code="not_task_owner")

    def _claim(self, task: ClearingTask, actor: Actor) -> None:
        if task.status is TaskStatus.CLAIMED and task.owner_id == actor.actor_id:
            return
        if task.status is not TaskStatus.UNASSIGNED:
            raise InvalidTransition(
                f"Task is already {task.status.value}.",
                code="task_not_claimable",
            )
        task.status = TaskStatus.CLAIMED
        task.owner_id = actor.actor_id
        self.ctx.repo.put_task(task)
        record_event(
            self.ctx,
            event_type="task_claimed",
            actor=actor,
            table_id=task.table_id,
            session_id=task.session_id,
        )

    def _start(self, task: ClearingTask, session: TableSession, actor: Actor) -> None:
        self._require_owner(task, actor)
        if task.status is not TaskStatus.CLAIMED or (
            session.operational_state is not OperationalState.NEEDS_CLEARING
        ):
            raise InvalidTransition(
                "Only a claimed task on a table that needs clearing can be started.",
                code="task_not_claimed",
            )
        task.status = TaskStatus.STARTED
        task.started_at = self.ctx.clock.now()
        transition(session, OperationalState.CLEANING)
        self.ctx.repo.put_task(task)
        self.ctx.repo.put_session(session)
        record_event(
            self.ctx,
            event_type="cleaning_started",
            actor=actor,
            table_id=task.table_id,
            session_id=session.session_id,
        )

    def _release(self, task: ClearingTask, session: TableSession, actor: Actor) -> None:
        self._require_owner(task, actor)
        if task.status not in (TaskStatus.CLAIMED, TaskStatus.STARTED):
            raise InvalidTransition("Only a claimed or started task can be released.")
        if task.status is TaskStatus.STARTED:
            transition(session, OperationalState.NEEDS_CLEARING)
            self.ctx.repo.put_session(session)
        task.status = TaskStatus.UNASSIGNED
        task.owner_id = None
        task.started_at = None
        self.ctx.repo.put_task(task)
        record_event(
            self.ctx,
            event_type="task_released",
            actor=actor,
            table_id=task.table_id,
            session_id=session.session_id,
        )

    def _cancel(
        self,
        task: ClearingTask,
        session: TableSession,
        actor: Actor,
        reason: str | None,
    ) -> None:
        reason = require_reason(reason)
        if task.status not in OPEN_TASK_STATUSES:
            raise InvalidTransition(f"Task is already {task.status.value}.")
        if task.status is TaskStatus.STARTED:
            transition(session, OperationalState.NEEDS_CLEARING)
            self.ctx.repo.put_session(session)
        task.status = TaskStatus.CANCELLED
        self.ctx.repo.put_task(task)
        record_event(
            self.ctx,
            event_type="task_cancelled",
            actor=actor,
            table_id=task.table_id,
            session_id=session.session_id,
            reason=reason,
        )
