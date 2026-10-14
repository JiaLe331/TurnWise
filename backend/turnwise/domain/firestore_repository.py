"""Firestore persistence for one outlet.

The in-memory repository stays the working set (board reads cost no Firestore reads). Each
committed outer transaction writes only the documents it changed, in batched commits; if the
write fails, memory rolls back and the request fails, so memory never runs ahead of Firestore.

Single writer: run exactly one API process per outlet.
"""

import hashlib
import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

from turnwise import contracts
from turnwise.contracts import (
    AuditEvent,
    CameraState,
    ClearingTask,
    QueueParty,
    SeatingHold,
    Table,
    TableSession,
)
from turnwise.domain.repository import InMemoryRepository, _snapshot

# collection name -> model, keyed by the in-memory dict key
KEYED = {
    "tables": Table,
    "sessions": TableSession,
    "tasks": ClearingTask,
    "camera_states": CameraState,
    "parties": QueueParty,
    "holds": SeatingHold,
}
BATCH_LIMIT = 450  # Firestore allows 500 writes per batch
OBSERVATION_TTL = timedelta(days=90)  # PRD metadata retention; enable a TTL policy on expire_at


class FirestoreRepository(InMemoryRepository):
    def __init__(self, outlet_id: str, client: Any) -> None:
        super().__init__(outlet_id)
        self._client = client
        self._root = client.collection("outlets").document(outlet_id)

    def load(self) -> bool:
        """Load persisted state. Returns False when the outlet has no tables yet."""
        with self._lock:
            data = self._data
            for name, model in KEYED.items():
                docs = [d.to_dict() for d in self._root.collection(name).stream()]
                docs.sort(key=lambda d: d.pop("_pos", 0))  # keep original insertion order
                for raw in docs:
                    item = model.model_validate(_decode(raw))
                    data[name][_key(name, item)] = item
            events = [d.to_dict() for d in self._root.collection("events").stream()]
            events.sort(key=lambda e: e.pop("_seq", 0))
            data["events"] = [AuditEvent.model_validate(e) for e in events]
            for doc in self._root.collection("idempotency").stream():
                raw = doc.to_dict()
                model = getattr(contracts, raw["type"])
                data["idempotency"][raw["key"]] = (
                    raw["fingerprint"],
                    model.model_validate_json(raw["result"]),
                )
            # Observations are history only (camera_states hold the latest); not reloaded.
            return bool(data["tables"])

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._lock:
            outer = self._depth == 0
            snapshot = _snapshot(self._data) if outer else None
            self._depth += 1
            try:
                yield
                if outer:
                    self._flush(snapshot)
            except BaseException:
                if snapshot is not None:
                    self._data = snapshot
                raise
            finally:
                self._depth -= 1

    def _flush(self, before: dict[str, Any]) -> None:
        writes: list[tuple[Any, dict]] = []
        for name in KEYED:
            old = before[name]
            for pos, (key, item) in enumerate(self._data[name].items()):
                if old.get(key) != item:
                    doc = _encode(item.model_dump(mode="json")) | {"_pos": pos}
                    writes.append((self._root.collection(name).document(key), doc))
        seen = {e.event_id for e in before["events"]}
        for seq, event in enumerate(self._data["events"]):
            if event.event_id not in seen:
                doc = event.model_dump(mode="json") | {"_seq": seq}
                writes.append((self._root.collection("events").document(event.event_id), doc))
        seen = {o.observation_id for o in before["observations"]}
        for obs in self._data["observations"]:
            if obs.observation_id not in seen:
                doc = obs.model_dump(mode="json") | {"expire_at": obs.received_at + OBSERVATION_TTL}
                ref = self._root.collection("observations").document(obs.observation_id)
                writes.append((ref, doc))
        for key, value in self._data["idempotency"].items():
            # Camera retries after a restart are rejected by the persisted sequence checkpoint,
            # so observation replies are not stored: saves one write per camera summary.
            if key not in before["idempotency"] and not key.startswith("observation:"):
                fingerprint, result = value
                doc_id = hashlib.sha256(key.encode()).hexdigest()
                writes.append(
                    (
                        self._root.collection("idempotency").document(doc_id),
                        {
                            "key": key,
                            "fingerprint": fingerprint,
                            "type": type(result).__name__,
                            "result": result.model_dump_json(),
                        },
                    )
                )
        # ponytail: chunked batches are not one atomic commit; past 450 writes a crash mid-flush
        # can persist a partial transaction. Normal transactions write a handful of documents.
        for start in range(0, len(writes), BATCH_LIMIT):
            batch = self._client.batch()
            for ref, doc in writes[start : start + BATCH_LIMIT]:
                batch.set(ref, doc)
            batch.commit()


def _key(name: str, item: Any) -> str:
    return {
        "tables": lambda t: t.table_id,
        "sessions": lambda s: s.table_id,
        "tasks": lambda t: t.task_id,
        "camera_states": lambda c: c.table_id,
        "parties": lambda p: p.party_id,
        "holds": lambda h: h.hold_id,
    }[name](item)


# Firestore rejects arrays of arrays (polygons), so the table region travels as JSON text.
def _encode(doc: dict) -> dict:
    if doc.get("region") is not None:
        doc["region"] = json.dumps(doc["region"])
    return doc


def _decode(doc: dict) -> dict:
    if isinstance(doc.get("region"), str):
        doc["region"] = json.loads(doc["region"])
    return doc
