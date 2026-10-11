from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from turnwise.contracts import VisualStatus


@dataclass(frozen=True)
class MaskedRegionReference:
    frame_id: str
    outlet_id: str
    table_id: str
    observed_at: datetime
    gateway_sequence: int
    configuration_version: int
    storage_uri: str


@dataclass(frozen=True)
class VisualEvidence:
    visual_status: VisualStatus
    object_flags: tuple[str, ...]
    occlusion: bool
    reason: str


class ObservationInterpreter(Protocol):
    async def interpret(self, region: MaskedRegionReference) -> VisualEvidence: ...
