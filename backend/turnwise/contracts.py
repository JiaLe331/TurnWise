from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class UserRole(StrEnum):
    HOST = "host"
    FLOOR_STAFF = "floor_staff"
    MANAGER = "manager"


class OperationalState(StrEnum):
    OCCUPIED = "occupied"
    DEPARTURE_REVIEW = "departure_review"
    NEEDS_CLEARING = "needs_clearing"
    CLEANING = "cleaning"
    READY = "ready"


class VisualStatus(StrEnum):
    OCCUPIED = "occupied"
    VACANT = "vacant"
    UNCLEAR = "unclear"


class TaskStatus(StrEnum):
    UNASSIGNED = "unassigned"
    CLAIMED = "claimed"
    STARTED = "started"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PartyStatus(StrEnum):
    WAITING = "waiting"
    ON_HOLD = "on_hold"
    SEATED = "seated"
    CANCELLED = "cancelled"
    LEFT = "left"


class Table(BaseModel):
    outlet_id: str
    table_id: str
    capacity: int
    zone: str
    attributes: list[str]
    camera_id: str | None
    region: dict[str, Any] | None
    configuration_version: int
    blocked: bool


class Observation(BaseModel):
    observation_id: str
    frame_id: str
    table_id: str
    observed_at: datetime
    received_at: datetime
    visual_status: VisualStatus
    object_flags: list[str]
    occlusion: bool
    model_version: str
    prompt_version: str


class TableSession(BaseModel):
    session_id: str
    table_id: str
    party_id: str | None
    operational_state: OperationalState
    state_version: int
    last_valid_observation_at: datetime | None
    seated_at: datetime | None
    departed_at: datetime | None
    ready_at: datetime | None
    manual: bool = False


class ClearingTask(BaseModel):
    task_id: str
    session_id: str
    table_id: str
    status: TaskStatus
    priority_reason: str
    owner_id: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class QueueParty(BaseModel):
    party_id: str
    queue_code: str
    size: int
    arrival_at: datetime
    requirements: list[str]
    status: PartyStatus


class CreatePartyRequest(BaseModel):
    queue_code: str
    size: int
    arrival_at: datetime
    requirements: list[str]


class SeatingHold(BaseModel):
    hold_id: str
    party_id: str
    table_id: str
    expires_at: datetime
    version: int


class AuditEvent(BaseModel):
    event_id: str
    outlet_id: str
    table_id: str | None
    party_id: str | None
    session_id: str | None
    event_type: str
    event_time: datetime
    received_at: datetime
    actor_type: str
    actor_id: str
    source: str
    reason: str | None


class ApiError(BaseModel):
    code: str
    message: str


class ActorType(StrEnum):
    HUMAN = "human"
    MODEL = "model"
    SYSTEM = "system"


class Actor(BaseModel):
    actor_id: str
    actor_type: ActorType = ActorType.HUMAN
    role: UserRole | None = None


class TableAction(StrEnum):
    REQUEST_DEPARTURE_REVIEW = "request_departure_review"
    DISMISS_REVIEW = "dismiss_review"
    CONFIRM_DEPARTURE = "confirm_departure"
    MARK_READY = "mark_ready"
    OVERRIDE_STATE = "override_state"
    RELEASE_OVERRIDE = "release_override"
    BLOCK = "block"
    UNBLOCK = "unblock"


class TaskAction(StrEnum):
    CLAIM = "claim"
    START = "start"
    RELEASE = "release"
    COMPLETE = "complete"
    CANCEL = "cancel"


class TableActionRequest(BaseModel):
    action: TableAction
    expected_version: int | None = None
    reason: str | None = None
    target_state: OperationalState | None = None


class TaskActionRequest(BaseModel):
    action: TaskAction
    expected_version: int | None = None
    reason: str | None = None


class TableBoardEntry(BaseModel):
    table: Table
    session: TableSession
    task: ClearingTask | None


class Board(BaseModel):
    outlet_id: str
    generated_at: datetime
    tables: list[TableBoardEntry]
    clearing_queue: list[TableBoardEntry]
