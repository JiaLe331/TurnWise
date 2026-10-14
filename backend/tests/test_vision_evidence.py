from datetime import UTC, datetime, timedelta

from turnwise.camera_manifest import CameraManifest, TableRegion, load_manifests
from turnwise.contracts import VisualStatus
from turnwise.worker.evidence import Detection, FrameEvidence, TableSummarizer, frame_evidence

LEFT = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]
RIGHT = [(90.0, 0.0), (200.0, 0.0), (200.0, 100.0), (90.0, 100.0)]
MANIFEST = CameraManifest(
    outlet_id="o",
    camera_id="c",
    name="C",
    configuration_version=1,
    width=300,
    height=300,
    tables=[
        TableRegion(table_id="A", tabletop=LEFT, seats=[LEFT]),
        TableRegion(table_id="B", tabletop=RIGHT, seats=[RIGHT]),
    ],
)
VACANT = FrameEvidence(VisualStatus.VACANT, 0, frozenset(), ())
OCCUPIED = FrameEvidence(VisualStatus.OCCUPIED, 1, frozenset(), ())


def person(cx, cy):
    return Detection("person", 0.9, (cx - 5, cy - 5, cx + 5, cy + 5))


def test_seated_aisle_and_ambiguous_people():
    ev = frame_evidence([person(50, 50), person(250, 250)], MANIFEST, None)
    assert ev["A"].status is VisualStatus.OCCUPIED
    assert ev["B"].status is VisualStatus.VACANT  # aisle passer at (250, 250) ignored

    ev = frame_evidence([person(95, 50)], MANIFEST, None)
    assert ev["A"].status is ev["B"].status is VisualStatus.UNCLEAR


def test_objects_flag_tables_and_frame_problems_are_unclear():
    cup = Detection("cup", 0.8, (140, 40, 150, 50))
    assert frame_evidence([cup], MANIFEST, None)["B"].object_flags == {"cup"}
    ev = frame_evidence([], MANIFEST, "too dark")
    assert all(e.status is VisualStatus.UNCLEAR for e in ev.values())


def test_summarizer_cadence_and_interruption():
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    s = TableSummarizer("A")
    out = []
    for i in range(201):  # 0..20s at 10 fps
        ev = OCCUPIED if 140 <= i <= 170 else VACANT
        summary = s.add(t0 + timedelta(seconds=i / 10), i / 10, ev)
        if summary:
            out.append(summary)
    starts = [(o.interval_started_at - t0).total_seconds() for o in out]
    ends = [(o.observed_at - t0).total_seconds() for o in out]
    assert starts == [0, 0, 10]  # first frame, 10s cadence, then immediate occupied
    assert ends == [0, 10, 14]
    assert out[1].occupied_seen is False
    assert out[2].occupied_seen is True and out[2].visual_status is VisualStatus.OCCUPIED


def test_processing_gap_breaks_coverage():
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    s = TableSummarizer("A")
    s.add(t0, 0, VACANT)
    s.add(t0 + timedelta(seconds=5), 5, VACANT)
    summary = s.add(t0 + timedelta(seconds=10), 10, VACANT)
    assert summary.continuous_valid_coverage is False


def test_repository_manifest_maps_known_tables():
    (manifest,) = load_manifests()
    assert manifest.camera_id == "cctv-01"
    assert (manifest.width, manifest.height) == (848, 480)


def test_display_smoother_holds_occupied_through_brief_misses():
    from turnwise.worker.evidence import DisplaySmoother

    smoother = DisplaySmoother()
    assert smoother.update(0.0, {"A": OCCUPIED})["A"] is VisualStatus.OCCUPIED
    assert smoother.update(1.0, {"A": VACANT})["A"] is VisualStatus.OCCUPIED  # missed frame
    assert smoother.update(8.9, {"A": VACANT})["A"] is VisualStatus.OCCUPIED  # 7.9s away
    assert smoother.update(9.0, {"A": VACANT})["A"] is VisualStatus.VACANT  # 8.0s away
    assert smoother.update(9.1, {"A": OCCUPIED})["A"] is VisualStatus.OCCUPIED  # back at once
