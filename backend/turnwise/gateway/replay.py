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
    FrameEvidence,
    Summary,
    TableSummarizer,
    frame_evidence,
)

log = logging.getLogger("turnwise.replay")

# ponytail: frame-level usability gate, calibrated on the sample clip only (mean luma ~100,
# Laplacian var >> 50). Re-tune on real outlet footage before trusting vacancy at night.
MIN_BRIGHTNESS, MAX_BRIGHTNESS, MIN_SHARPNESS = 25.0, 235.0, 20.0
STATUS_COLORS = {  # BGR
    VisualStatus.OCCUPIED: (60, 160, 255),
    VisualStatus.VACANT: (120, 200, 90),
    VisualStatus.UNCLEAR: (180, 180, 180),
}


class Detector(Protocol):
    model_version: str

    def detect(self, frame_bgr) -> list[Detection]: ...


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
                        detections = self.detector.detect(frame)
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
                now = time.monotonic()
                if last_done is not None:
                    inst = 1 / max(now - last_done, 1e-6)
                    fps_ema = inst if fps_ema is None else 0.9 * fps_ema + 0.1 * inst
                last_done = now
                processed += 1
                jpeg = None
                if ok:
                    image = annotate(
                        cv2, frame, detections, self.manifest, evidence, media, duration
                    )
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
                    tables=_table_text(evidence),
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


def _table_text(evidence: dict[str, FrameEvidence]) -> dict[str, str]:
    return {
        tid: f"{ev.status.value}, {ev.seated} seated"
        + (f", {', '.join(sorted(ev.object_flags))}" if ev.object_flags else "")
        + (f" ({'; '.join(ev.reasons)})" if ev.reasons else "")
        for tid, ev in evidence.items()
    }


def annotate(cv2, frame, detections, manifest, evidence, media: float, duration: float):
    import numpy as np

    image = frame.copy()
    for table in manifest.tables:
        ev = evidence[table.table_id]
        color = STATUS_COLORS[ev.status]
        cv2.polylines(image, [np.int32(table.tabletop)], True, color, 2)
        for seat in table.seats:
            cv2.polylines(image, [np.int32(seat)], True, color, 1)
        x, y = (int(v) for v in table.tabletop[0])
        _label(cv2, image, f"{table.table_id} {ev.status.value}", (x, y - 4), color)
    for det in detections:
        if det.class_name != "person" and det.class_name not in ("cup", "bowl", "bottle"):
            continue
        x1, y1, x2, y2 = (int(v) for v in det.xyxy)
        cv2.rectangle(image, (x1, y1), (x2, y2), (255, 255, 255), 1)
        _label(cv2, image, f"{det.class_name} {det.confidence:.2f}", (x1, y2 + 10), (40, 40, 40))
    clock = f"{_mmss(media)} / {_mmss(duration)}  Recorded replay 1x"
    _label(cv2, image, clock, (8, image.shape[0] - 8), (20, 20, 20), scale=0.5)
    return image


def _label(cv2, image, text, origin, bg, scale=0.4) -> None:
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    x, y = origin
    cv2.rectangle(image, (x - 2, y - h - 3), (x + w + 2, y + 3), bg, -1)
    cv2.putText(image, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 1)


def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"
