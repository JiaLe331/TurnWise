"""Fixed camera-to-table mapping shared by the API (identity) and the vision process (polygons)."""

from pathlib import Path

from pydantic import BaseModel, Field

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "config" / "cameras"

Point = tuple[float, float]


class TableRegion(BaseModel):
    table_id: str
    tabletop: list[Point] = Field(min_length=3)
    seats: list[list[Point]] = Field(min_length=1)


class CameraManifest(BaseModel):
    outlet_id: str
    camera_id: str
    name: str
    configuration_version: int = Field(ge=1)
    width: int
    height: int
    tables: list[TableRegion]
    # x1, y1, x2, y2 areas where people are small (far side of the room); the detector also runs
    # on these crops upscaled 2x, which recovers distant seated guests.
    detail_tiles: list[tuple[int, int, int, int]] = Field(default_factory=list)


def load_manifests(directory: Path = DEFAULT_DIR) -> list[CameraManifest]:
    if not directory.is_dir():
        return []
    return [
        CameraManifest.model_validate_json(path.read_text())
        for path in sorted(directory.glob("*.json"))
    ]
