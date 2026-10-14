import copy
import threading
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Any, Protocol

from turnwise.contracts import (
    AuditEvent,
    CameraState,
    ClearingTask,
    HoldStatus,
    Observation,
    QueueParty,
    SeatingHold,
    Table,
    TableSession,
    TaskStatus,
)

MAX_OBSERVATIONS = 5_000
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

    def get_camera_state(self, table_id: str) -> CameraState | None: ...
    def put_camera_state(self, state: CameraState) -> None: ...
    def list_camera_states(self) -> list[CameraState]: ...
    def append_observation(self, observation: Observation) -> None: ...
    def list_observations(self, table_id: str | None = None) -> list[Observation]: ...

    def get_party(self, party_id: str) -> QueueParty | None: ...
    def put_party(self, party: QueueParty) -> None: ...
    def list_parties(self) -> list[QueueParty]: ...
    def get_hold(self, hold_id: str) -> SeatingHold | None: ...
    def put_hold(self, hold: SeatingHold) -> None: ...
    def list_active_holds(self) -> list[SeatingHold]: ...


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
            "camera_states": {},
            "observations": [],
            "parties": {},
            "holds": {},
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

    def get_camera_state(self, table_id: str) -> CameraState | None:
        with self._lock:
            state = self._data["camera_states"].get(table_id)
            return state.model_copy(deep=True) if state else None

    def put_camera_state(self, state: CameraState) -> None:
        with self._lock:
            self._data["camera_states"][state.table_id] = state.model_copy(deep=True)

    def list_camera_states(self) -> list[CameraState]:
        with self._lock:
            return [s.model_copy(deep=True) for s in self._data["camera_states"].values()]

    def append_observation(self, observation: Observation) -> None:
        with self._lock:
            observations = self._data["observations"]
            observations.append(observation.model_copy(deep=True))
            # ponytail: keep newest N in memory; Firestore (A) owns the real retention policy.
            del observations[:-MAX_OBSERVATIONS]

    def list_observations(self, table_id: str | None = None) -> list[Observation]:
        with self._lock:
            return [
                o.model_copy(deep=True)
                for o in self._data["observations"]
                if table_id is None or o.table_id == table_id
            ]

    def get_party(self, party_id: str) -> QueueParty | None:
        with self._lock:
            party = self._data["parties"].get(party_id)
            return party.model_copy(deep=True) if party else None

    def put_party(self, party: QueueParty) -> None:
        with self._lock:
            self._data["parties"][party.party_id] = party.model_copy(deep=True)

    def list_parties(self) -> list[QueueParty]:
        with self._lock:
            return [p.model_copy(deep=True) for p in self._data["parties"].values()]

    def get_hold(self, hold_id: str) -> SeatingHold | None:
        with self._lock:
            hold = self._data["holds"].get(hold_id)
            return hold.model_copy(deep=True) if hold else None

    def put_hold(self, hold: SeatingHold) -> None:
        with self._lock:
            self._data["holds"][hold.hold_id] = hold.model_copy(deep=True)

    def list_active_holds(self) -> list[SeatingHold]:
        with self._lock:
            return [
                h.model_copy(deep=True)
                for h in self._data["holds"].values()
                if h.status is HoldStatus.ACTIVE
            ]
