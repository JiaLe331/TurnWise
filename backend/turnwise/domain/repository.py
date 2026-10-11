import copy
import threading
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Any, Protocol

from turnwise.contracts import AuditEvent, ClearingTask, Table, TableSession, TaskStatus

OPEN_TASK_STATUSES = frozenset({TaskStatus.UNASSIGNED, TaskStatus.CLAIMED, TaskStatus.STARTED})


class OutletRepository(Protocol):
    outlet_id: str

    def transaction(self) -> AbstractContextManager[None]: ...

    def get_table(self, table_id: str) -> Table | None: ...
    def list_tables(self) -> list[Table]: ...
    def put_table(self, table: Table) -> None: ...

    def get_session(self, table_id: str) -> TableSession | None: ...
    def put_session(self, session: TableSession) -> None: ...

    def get_task(self, task_id: str) -> ClearingTask | None: ...
    def put_task(self, task: ClearingTask) -> None: ...
    def find_task(self, session_id: str) -> ClearingTask | None: ...
    def find_open_task(self, session_id: str) -> ClearingTask | None: ...

    def append_event(self, event: AuditEvent) -> None: ...
    def list_events(self, table_id: str | None = None) -> list[AuditEvent]: ...

    def get_idempotent(self, key: str) -> tuple[str, Any] | None: ...
    def put_idempotent(self, key: str, fingerprint: str, result: Any) -> None: ...


class InMemoryRepository:
    """Single-outlet store. Transactions are serialized and roll back on error."""

    def __init__(self, outlet_id: str) -> None:
        self.outlet_id = outlet_id
        self._lock = threading.RLock()
        self._depth = 0
        self._data: dict[str, Any] = {
            "tables": {},
            "sessions": {},
            "tasks": {},
            "events": [],
            "idempotency": {},
        }

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._lock:
            snapshot = copy.deepcopy(self._data) if self._depth == 0 else None
            self._depth += 1
            try:
                yield
            except BaseException:
                if snapshot is not None:
                    self._data = snapshot
                raise
            finally:
                self._depth -= 1

    def get_table(self, table_id: str) -> Table | None:
        with self._lock:
            table = self._data["tables"].get(table_id)
            return table.model_copy(deep=True) if table else None

    def list_tables(self) -> list[Table]:
        with self._lock:
            return [t.model_copy(deep=True) for t in self._data["tables"].values()]

    def put_table(self, table: Table) -> None:
        with self._lock:
            self._data["tables"][table.table_id] = table.model_copy(deep=True)

    def get_session(self, table_id: str) -> TableSession | None:
        with self._lock:
            session = self._data["sessions"].get(table_id)
            return session.model_copy(deep=True) if session else None

    def put_session(self, session: TableSession) -> None:
        with self._lock:
            self._data["sessions"][session.table_id] = session.model_copy(deep=True)

    def get_task(self, task_id: str) -> ClearingTask | None:
        with self._lock:
            task = self._data["tasks"].get(task_id)
            return task.model_copy(deep=True) if task else None

    def put_task(self, task: ClearingTask) -> None:
        with self._lock:
            self._data["tasks"][task.task_id] = task.model_copy(deep=True)

    def find_task(self, session_id: str) -> ClearingTask | None:
        with self._lock:
            matches = [t for t in self._data["tasks"].values() if t.session_id == session_id]
            if not matches:
                return None
            return max(matches, key=lambda t: t.created_at).model_copy(deep=True)

    def find_open_task(self, session_id: str) -> ClearingTask | None:
        task = self.find_task(session_id)
        return task if task and task.status in OPEN_TASK_STATUSES else None

    def append_event(self, event: AuditEvent) -> None:
        with self._lock:
            self._data["events"].append(event.model_copy(deep=True))

    def list_events(self, table_id: str | None = None) -> list[AuditEvent]:
        with self._lock:
            return [
                e.model_copy(deep=True)
                for e in self._data["events"]
                if table_id is None or e.table_id == table_id
            ]

    def get_idempotent(self, key: str) -> tuple[str, Any] | None:
        with self._lock:
            found = self._data["idempotency"].get(key)
            return copy.deepcopy(found) if found else None

    def put_idempotent(self, key: str, fingerprint: str, result: Any) -> None:
        with self._lock:
            self._data["idempotency"][key] = (fingerprint, copy.deepcopy(result))
