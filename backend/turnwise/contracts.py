from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field


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


class ObservationSubmission(BaseModel):
    """One interval summary for one table, sent by the authenticated local vision service."""

    observation_id: str = Field(min_length=1, max_length=128)
    frame_id: str = Field(min_length=1, max_length=128)
    outlet_id: str
    camera_id: str
    table_id: str
    configuration_version: int
    stream_id: str = Field(min_length=1, max_length=128)
    gateway_sequence: int = Field(ge=0)
    interval_started_at: AwareDatetime
    observed_at: AwareDatetime
    continuous_valid_coverage: bool
    occupied_seen: bool
    unclear_seen: bool
    visual_status: VisualStatus
    object_flags: list[str] = Field(default_factory=list, max_length=20)
    occlusion: bool
    reason: str = Field(default="", max_length=300)
    uncertainty_reasons: list[str] = Field(default_factory=list, max_length=10)
    source_mode: Literal["replay", "live"]
    recording_id: str | None = None
    media_offset_s: float | None = None
    model_version: str
    policy_version: str
    prompt_version: str | None = None


class Observation(ObservationSubmission):
    received_at: datetime
    session_id: str


class CameraState(BaseModel):
    """Server-owned per-table vision state: ordering checkpoint and vacancy continuity."""

    table_id: str
    camera_id: str
    stream_id: str | None = None
    retired_streams: list[str] = Field(default_factory=list)
    last_sequence: int = -1
    reset_at: datetime | None = None
    last_observed_at: datetime | None = None
    vacant_since: datetime | None = None
    review_version: int | None = None  # session.state_version when vision requested review
    stale_recorded: bool = False
    latest: Observation | None = None


class TableEvidence(BaseModel):
    camera_id: str
    source_mode: str | None
    visual_status: VisualStatus | None
    object_flags: list[str]
    occlusion: bool
    reason: str | None
    uncertainty_reasons: list[str]
    model_version: str | None
    last_observed_at: datetime | None
    vacant_since: datetime | None
    stale: bool
    review_source: Literal["observation"] | None


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
    version: int = 1
    table_id: str | None = None
    seated_at: datetime | None = None
    ended_at: datetime | None = None


class CreatePartyRequest(BaseModel):
    queue_code: str = Field(min_length=1, max_length=16)
    size: int = Field(ge=1, le=20)
    arrival_at: AwareDatetime | None = None
    requirements: list[str] = Field(default_factory=list, max_length=10)


class PartyAction(StrEnum):
    UPDATE = "update"
    CANCEL = "cancel"
    LEFT = "left"


class PartyActionRequest(BaseModel):
    action: PartyAction
    expected_version: int
    size: int | None = Field(default=None, ge=1, le=20)
    requirements: list[str] | None = Field(default=None, max_length=10)
    reason: str | None = None


class HoldStatus(StrEnum):
    ACTIVE = "active"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class SeatingHold(BaseModel):
    hold_id: str
    party_id: str
    table_id: str
    expires_at: datetime
    version: int
    status: HoldStatus = HoldStatus.ACTIVE
    created_at: datetime
    created_by: str
    table_state_version: int
    manual: bool = False
    override_reason: str | None = None


class CreateHoldRequest(BaseModel):
    party_id: str
    table_id: str
    party_version: int
    table_version: int
    override_reason: str | None = Field(default=None, max_length=300)


class HoldAction(StrEnum):
    CONFIRM = "confirm"
    CANCEL = "cancel"


class HoldActionRequest(BaseModel):
    action: HoldAction
    expected_version: int
    reason: str | None = None


class TableOption(BaseModel):
    table_id: str
    capacity: int
    zone: str
    attributes: list[str]
    table_version: int
    ready_at: datetime | None
    evidence: Literal["camera", "manual"]
    reason: str


class QueueSkip(BaseModel):
    party_id: str
    queue_code: str
    reason: str


class Recommendation(BaseModel):
    generated_at: datetime
    party: QueueParty | None
    tables: list[TableOption]
    skipped: list[QueueSkip]
    message: str


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
    evidence: TableEvidence | None = None


class Board(BaseModel):
    outlet_id: str
    generated_at: datetime
    tables: list[TableBoardEntry]
    clearing_queue: list[TableBoardEntry]
    waitlist: list[QueueParty] = Field(default_factory=list)
    holds: list[SeatingHold] = Field(default_factory=list)


class SeatingResult(BaseModel):
    hold: SeatingHold
    party: QueueParty
    table: TableBoardEntry
