"""1x recorded-video replay: decode -> detect -> table evidence -> summaries + annotated preview.

The replay loop and the preview slot live in one process so the browser sees exactly the frames
that produced the evidence.
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from turnwise.camera_manifest import CameraManifest
from turnwise.contracts import ObservationSubmission, VisualStatus
from turnwise.worker.evidence import (
    POLICY_VERSION,
    Detection,
    DisplaySmoother,
    FrameEvidence,
    Summary,
    TableSummarizer,
    frame_evidence,
)

log = logging.getLogger("turnwise.replay")

# ponytail: frame-level usability gate, calibrated on the sample clip only (mean luma ~100,
# Laplacian var >> 50). Re-tune on real outlet footage before trusting vacancy at night.
MIN_BRIGHTNESS, MAX_BRIGHTNESS, MIN_SHARPNESS = 25.0, 235.0, 20.0
# Zone colours (BGR), camera-wall style: amber occupied, green vacant, grey unclear,
# red for a vacant table that still shows tabletop items.
STATUS_COLORS = {
    VisualStatus.OCCUPIED: (64, 178, 236),
    VisualStatus.VACANT: (110, 205, 120),
    VisualStatus.UNCLEAR: (170, 170, 170),
}
ITEMS_LEFT_COLOR = (80, 80, 225)
PREVIEW_SCALE = 1.5  # draw on an upscaled frame so labels stay crisp
ZONE_ALPHA = 0.4


class Detector(Protocol):
    model_version: str

    def detect_with_tiles(self, frame_bgr, tiles) -> list[Detection]: ...


class Publisher(Protocol):
    def publish(self, submission: ObservationSubmission) -> None: ...


@dataclass
class PreviewSlot:
    """Single latest-frame slot. Readers that fall behind skip straight to the newest frame."""

    status: str = "ready_to_start"
    jpeg: bytes | None = None
    seq: int = 0
    meta: dict = field(default_factory=dict)
    _cond: threading.Condition = field(default_factory=threading.Condition)

    def put(self, jpeg: bytes | None, **meta) -> None:
        with self._cond:
            if jpeg is not None:
                self.jpeg = jpeg
                self.seq += 1
            self.meta.update(meta)
            self.status = meta.get("status", self.status)
            self._cond.notify_all()

    def wait_newer(self, seq: int, timeout: float) -> tuple[int, bytes | None]:
        with self._cond:
            self._cond.wait_for(lambda: self.seq > seq, timeout)
            return self.seq, self.jpeg

    def snapshot(self) -> dict:
        with self._cond:
            meta = dict(self.meta)
            meta["status"] = self.status
            processed = meta.get("last_processed_at")
            meta["frame_age_s"] = (
                round((datetime.now(UTC) - processed).total_seconds(), 2) if processed else None
            )
            return meta


def frame_problem(frame, cv2) -> str | None:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    if brightness < MIN_BRIGHTNESS:
        return "too dark"
    if brightness > MAX_BRIGHTNESS:
        return "overexposed"
    if cv2.Laplacian(gray, cv2.CV_64F).var() < MIN_SHARPNESS:
        return "blurred or blocked"
    return None


class ReplayRunner:
    def __init__(
        self,
        source: Path,
        manifest: CameraManifest,
        detector: Detector,
        publisher: Publisher | None,
        slot: PreviewSlot,
        recording_id: str | None = None,
    ) -> None:
        self.source = source
        self.manifest = manifest
        self.detector = detector
        self.publisher = publisher
        self.slot = slot
        self.recording_id = recording_id or source.stem
        self.run_id = f"replay-{uuid4().hex[:12]}"
        self._stop = threading.Event()
        self._seq = 0

    def stop(self) -> None:
        self._stop.set()

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self.run, name="replay", daemon=True)
        thread.start()
        return thread

    def run(self) -> None:
        import cv2

        base = {
            "run_id": self.run_id,
            "camera_id": self.manifest.camera_id,
            "camera_name": self.manifest.name,
            "source_mode": "replay",
            "playback_rate": 1.0,
            "recording_id": self.recording_id,
            "model_version": self.detector.model_version,
        }
        self.slot.put(None, status="starting", **base)
        cap = cv2.VideoCapture(str(self.source))
        if not cap.isOpened():
            self.slot.put(None, status="unavailable", reason=f"cannot open {self.source.name}")
            return
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        if size != (self.manifest.width, self.manifest.height):
            # Mapping polygons are in source pixels; a different size invalidates them.
            reason = (
                f"source {size} does not match mapping {self.manifest.width}x{self.manifest.height}"
            )
            self.slot.put(None, status="unavailable", reason=reason)
            return
        duration = frames / fps
        summarizers = {t.table_id: TableSummarizer(t.table_id) for t in self.manifest.tables}
        display = DisplaySmoother()
        started_at = datetime.now(UTC)
        wall0 = time.monotonic()
        first_ts: float | None = None
        last_ts = -1.0
        processed = dropped = failures = 0
        fps_ema: float | None = None
        last_done = None
        status = "ended"
        try:
            while not self._stop.is_set():
                if not cap.grab():
                    status = "ended" if processed + dropped >= frames - 2 else "unavailable"
                    break
                ts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
                if first_ts is None:
                    first_ts = ts
                if ts <= last_ts:
                    status = "unavailable"
                    log.error("non-monotonic media timestamp %.3f after %.3f", ts, last_ts)
                    break
                last_ts = ts
                media = ts - first_ts
                lag = time.monotonic() - (wall0 + media)
                if lag > 1 / fps:  # behind real time: drop instead of accumulating latency
                    dropped += 1
                    continue
                if lag < 0:
                    time.sleep(-lag)
                ok, frame = cap.retrieve()
                at = started_at + timedelta(seconds=media)
                detections: list[Detection] = []
                problem = None if ok else "decode failure"
                if ok:
                    try:
                        detections = self.detector.detect_with_tiles(
                            frame, self.manifest.detail_tiles
                        )
                        problem = frame_problem(frame, cv2)
                    except Exception:
                        log.exception("inference failed")
                        problem = "inference failure"
                if problem in ("decode failure", "inference failure"):
                    failures += 1
                evidence = frame_evidence(detections, self.manifest, problem)
                for table_id, ev in evidence.items():
                    summary = summarizers[table_id].add(at, media, ev)
                    if summary is not None:
                        self._publish(summary)
                shown = display.update(media, evidence)
                now = time.monotonic()
                if last_done is not None:
                    inst = 1 / max(now - last_done, 1e-6)
                    fps_ema = inst if fps_ema is None else 0.9 * fps_ema + 0.1 * inst
                last_done = now
                processed += 1
                jpeg = None
                if ok:
                    image = annotate(cv2, frame, self.manifest, shown, evidence, media, duration)
                    jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 75])[1].tobytes()
                self.slot.put(
                    jpeg,
                    status="processing",
                    media_offset_s=round(media, 2),
                    duration_s=round(duration, 2),
                    last_frame_captured_at=at,
                    last_processed_at=datetime.now(UTC),
                    measured_fps=round(fps_ema, 1) if fps_ema else None,
                    processed_frames=processed,
                    dropped_frames=dropped,
                    failed_frames=failures,
                    tables=_table_text(evidence, shown),
                )
        finally:
            cap.release()
            reason = None if status == "ended" else "decode stopped before end of file"
            self.slot.put(None, status=status, reason=reason)
            log.info(
                "replay %s %s: processed=%d dropped=%d failed=%d",
                self.run_id,
                status,
                processed,
                dropped,
                failures,
            )

    def _publish(self, s: Summary) -> None:
        if self.publisher is None:
            return
        self._seq += 1
        unclear = s.unclear_seen or s.visual_status is VisualStatus.UNCLEAR
        self.publisher.publish(
            ObservationSubmission(
                observation_id=f"{self.run_id}-{s.table_id}-{self._seq}",
                frame_id=f"{self.run_id}-{s.media_offset_s:.2f}",
                outlet_id=self.manifest.outlet_id,
                camera_id=self.manifest.camera_id,
                table_id=s.table_id,
                configuration_version=self.manifest.configuration_version,
                stream_id=self.run_id,
                gateway_sequence=self._seq,
                interval_started_at=s.interval_started_at,
                observed_at=s.observed_at,
                continuous_valid_coverage=s.continuous_valid_coverage,
                occupied_seen=s.occupied_seen,
                unclear_seen=s.unclear_seen,
                visual_status=s.visual_status,
                object_flags=s.object_flags,
                occlusion=unclear,
                reason=", ".join(s.reasons)[:300],
                uncertainty_reasons=s.reasons[:10],
                source_mode="replay",
                recording_id=self.recording_id,
                media_offset_s=s.media_offset_s,
                model_version=self.detector.model_version,
                policy_version=POLICY_VERSION,
            )
        )


def _table_text(
    evidence: dict[str, FrameEvidence], shown: dict[str, VisualStatus]
) -> dict[str, str]:
    return {
        tid: f"{shown[tid].value}, {ev.seated} seated now"
        + (f", {', '.join(sorted(ev.object_flags))}" if ev.object_flags else "")
        + (f" ({'; '.join(ev.reasons)})" if ev.reasons else "")
        for tid, ev in evidence.items()
    }


def annotate(cv2, frame, manifest, shown, evidence, media: float, duration: float):
    """Camera-wall preview: a translucent zone over each table and its seats, a status tag,
    the camera name and the replay clock. No person or object boxes."""
    import numpy as np

    k = PREVIEW_SCALE
    image = cv2.resize(frame, None, fx=k, fy=k, interpolation=cv2.INTER_LINEAR)
    zones = []
    for table in manifest.tables:
        points = np.float32([*table.tabletop, *(p for seat in table.seats for p in seat)]) * k
        hull = cv2.convexHull(points).astype(np.int32)
        status = shown[table.table_id]
        ev = evidence[table.table_id]
        items = sorted(ev.object_flags - {"belongings"})
        color = STATUS_COLORS[status]
        text = f"{table.table_id} {status.value}"
        if status is VisualStatus.OCCUPIED and ev.seated:
            text += f" {ev.seated}"
        elif status is VisualStatus.VACANT and items:
            color, text = ITEMS_LEFT_COLOR, f"{table.table_id} vacant, items left"
        zones.append((hull, color, text))

    overlay = image.copy()
    for hull, color, _ in zones:
        cv2.fillPoly(overlay, [hull], color, lineType=cv2.LINE_AA)
    image = cv2.addWeighted(overlay, ZONE_ALPHA, image, 1 - ZONE_ALPHA, 0)
    placed: list[tuple[int, int, int, int]] = []
    for hull, color, text in zones:
        cv2.polylines(image, [hull], True, color, 2, lineType=cv2.LINE_AA)
        x, y, _, _ = cv2.boundingRect(hull)
        placed.append(_tag(cv2, image, text, (x + 4, y + 4), color, (25, 25, 25), placed))
    _pill(cv2, image, manifest.name.upper(), (12, 12))
    clock = f"{_mmss(media)} / {_mmss(duration)}  RECORDED REPLAY 1x"
    h = image.shape[0]
    _pill(cv2, image, clock, (12, h - 36))
    return image


FONT = 0  # cv2.FONT_HERSHEY_SIMPLEX


def _tag(cv2, image, text, origin, bg, fg, placed, scale=0.45):
    """Small filled tag; moves down past tags it would overlap."""
    (w, h), _ = cv2.getTextSize(text, FONT, scale, 1)
    x, y = origin
    box = (x, y, x + w + 10, y + h + 10)
    while any(
        not (box[2] < p[0] or box[0] > p[2] or box[3] < p[1] or box[1] > p[3]) for p in placed
    ):
        y = box[3] + 3
        box = (x, y, x + w + 10, y + h + 10)
    cv2.rectangle(image, box[:2], box[2:], bg, -1)
    cv2.putText(image, text, (x + 5, y + h + 4), FONT, scale, fg, 1, cv2.LINE_AA)
    return box


def _pill(cv2, image, text, origin, scale=0.55) -> None:
    (w, h), _ = cv2.getTextSize(text, FONT, scale, 1)
    x, y = origin
    overlay = image.copy()
    cv2.rectangle(overlay, (x, y), (x + w + 20, y + h + 14), (30, 30, 30), -1)
    cv2.addWeighted(overlay, 0.75, image, 0.25, 0, dst=image)
    cv2.putText(image, text, (x + 10, y + h + 7), FONT, scale, (235, 235, 235), 1, cv2.LINE_AA)


def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"
