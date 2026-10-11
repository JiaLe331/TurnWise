from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class CapturedFrame:
    camera_id: str
    observed_at: datetime
    image_bytes: bytes


@dataclass(frozen=True)
class MaskedTableRegion:
    frame_id: str
    outlet_id: str
    table_id: str
    observed_at: datetime
    gateway_sequence: int
    configuration_version: int
    image_bytes: bytes


class FrameSource(Protocol):
    async def capture(self) -> CapturedFrame: ...


class RegionMasker(Protocol):
    def mask(self, frame: CapturedFrame) -> list[MaskedTableRegion]: ...


class RegionPublisher(Protocol):
    async def publish(self, region: MaskedTableRegion) -> None: ...
