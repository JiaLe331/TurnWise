"""Turn detector boxes into per-table evidence and interval summaries. No ML imports here."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from turnwise.camera_manifest import CameraManifest, Point
from turnwise.contracts import VisualStatus

POLICY_VERSION = "evidence-v1"
SUMMARY_EVERY = timedelta(seconds=10)
FRAME_GAP_LIMIT = timedelta(seconds=2)
TABLETOP_OBJECTS = frozenset(
    {"cup", "bowl", "bottle", "wine glass", "fork", "knife", "spoon", "pizza", "sandwich", "cake"}
)
BELONGINGS = frozenset({"handbag", "backpack", "cell phone", "laptop", "umbrella", "suitcase"})


@dataclass(frozen=True)
class Detection:
    class_name: str
    confidence: float
    xyxy: tuple[float, float, float, float]

    @property
    def center(self) -> Point:
        x1, y1, x2, y2 = self.xyxy
        return ((x1 + x2) / 2, (y1 + y2) / 2)


@dataclass(frozen=True)
class FrameEvidence:
    status: VisualStatus
    seated: int
    object_flags: frozenset[str]
    reasons: tuple[str, ...]


def inside(point: Point, polygon: list[Point]) -> bool:
    """Ray casting point-in-polygon."""
    x, y = point
    hit = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def frame_evidence(
    detections: list[Detection],
    manifest: CameraManifest,
    frame_problem: str | None,
) -> dict[str, FrameEvidence]:
    """One processed frame -> evidence per mapped table.

    People are associated by box center in a seat polygon (seated people's boxes extend past
    the tabletop); a center in no seat polygon is an aisle passer and ignored. A center in seat
    polygons of two tables is ambiguous and makes both unclear rather than guessing.
    """
    if frame_problem is not None:
        return {
            t.table_id: FrameEvidence(VisualStatus.UNCLEAR, 0, frozenset(), (frame_problem,))
            for t in manifest.tables
        }
    seated = {t.table_id: 0 for t in manifest.tables}
    ambiguous: set[str] = set()
    flags: dict[str, set[str]] = {t.table_id: set() for t in manifest.tables}
    for det in detections:
        if det.class_name == "person":
            owners = [
                t.table_id for t in manifest.tables if any(inside(det.center, s) for s in t.seats)
            ]
            if len(owners) == 1:
                seated[owners[0]] += 1
            elif len(owners) > 1:
                ambiguous.update(owners)
        elif det.class_name in TABLETOP_OBJECTS | BELONGINGS:
            for t in manifest.tables:
                if inside(det.center, t.tabletop) or (
                    det.class_name in BELONGINGS and any(inside(det.center, s) for s in t.seats)
                ):
                    flags[t.table_id].add(
                        "belongings" if det.class_name in BELONGINGS else det.class_name
                    )
    result = {}
    for table_id, count in seated.items():
        if count:
            status, reasons = VisualStatus.OCCUPIED, ()
        elif table_id in ambiguous:
            status, reasons = VisualStatus.UNCLEAR, ("person between tables",)
        else:
            status, reasons = VisualStatus.VACANT, ()
        result[table_id] = FrameEvidence(status, count, frozenset(flags[table_id]), reasons)
    return result


@dataclass
class Summary:
    table_id: str
    interval_started_at: datetime
    observed_at: datetime
    media_offset_s: float
    continuous_valid_coverage: bool
    occupied_seen: bool
    unclear_seen: bool
    visual_status: VisualStatus
    object_flags: list[str]
    reasons: list[str]


@dataclass
class _Interval:
    started_at: datetime
    last_frame_at: datetime
    continuous: bool = True
    occupied: bool = False
    unclear: bool = False
    flags: set[str] = field(default_factory=set)
    reasons: set[str] = field(default_factory=set)


class TableSummarizer:
    """Folds processed frames for one table into summaries.

    Emits on the first frame, every 10s of media time, and immediately when the frame status
    turns occupied/unclear after the last emitted status. Every frame in an interval counts, so
    a guest seen at 14s and gone at 17s still marks the summary ending at 20s as occupied.
    """

    def __init__(self, table_id: str) -> None:
        self.table_id = table_id
        self._interval: _Interval | None = None
        self._last_status: VisualStatus | None = None

    def add(self, at: datetime, media_offset_s: float, ev: FrameEvidence) -> Summary | None:
        iv = self._interval
        if iv is None:
            iv = self._interval = _Interval(started_at=at, last_frame_at=at)
        elif at - iv.last_frame_at > FRAME_GAP_LIMIT:
            iv.continuous = False
            iv.reasons.add("processing gap")
        iv.last_frame_at = at
        iv.occupied |= ev.status is VisualStatus.OCCUPIED
        iv.unclear |= ev.status is VisualStatus.UNCLEAR
        iv.flags |= ev.object_flags
        iv.reasons.update(ev.reasons)

        first = self._last_status is None
        turned = ev.status is not self._last_status and ev.status is not VisualStatus.VACANT
        if not (first or turned or at - iv.started_at >= SUMMARY_EVERY):
            return None
        summary = Summary(
            table_id=self.table_id,
            interval_started_at=iv.started_at,
            observed_at=at,
            media_offset_s=media_offset_s,
            continuous_valid_coverage=iv.continuous,
            occupied_seen=iv.occupied,
            unclear_seen=iv.unclear,
            visual_status=ev.status,
            object_flags=sorted(iv.flags),
            reasons=sorted(iv.reasons),
        )
        self._last_status = ev.status
        self._interval = _Interval(started_at=at, last_frame_at=at)
        return summary


DISPLAY_HOLD_S = 8.0  # longest detector gap seen on a seated guest in the sample: 6.25s


class DisplaySmoother:
    """Preview label only (evidence and the API are unaffected): a table shows occupied as soon
    as a guest is seen, and leaves occupied only after DISPLAY_HOLD_S seconds without one, so a
    single missed detection does not flicker the label."""

    def __init__(self) -> None:
        self._shown: dict[str, VisualStatus] = {}
        self._away_since: dict[str, float] = {}

    def update(self, media_s: float, evidence: dict[str, FrameEvidence]) -> dict[str, VisualStatus]:
        for table_id, ev in evidence.items():
            if ev.status is VisualStatus.OCCUPIED:
                self._away_since.pop(table_id, None)
                self._shown[table_id] = ev.status
                continue
            since = self._away_since.setdefault(table_id, media_s)
            shown = self._shown.get(table_id)
            if shown is not VisualStatus.OCCUPIED or media_s - since >= DISPLAY_HOLD_S:
                self._shown[table_id] = ev.status
        return dict(self._shown)
