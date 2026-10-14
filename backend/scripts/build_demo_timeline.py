"""Precompute the live-demo timeline from the Mixkit clip.

Detection runs once here (offline, any speed), Gemini table checks are real calls made once,
and the result is a small JSON file the API replays per demo session and the browser uses to
draw overlays in sync with the video. No GPU or camera is needed at demo time.

    uv run --group vision python scripts/build_demo_timeline.py
"""

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from turnwise.camera_manifest import CameraManifest
from turnwise.contracts import VisualStatus
from turnwise.settings import load_env
from turnwise.worker.evidence import Detection, frame_evidence

DEMO = BACKEND / "demo"
CLIP = BACKEND / "recordings" / "mixkit-minimalist-restaurant-4385.mp4"
HOLD_S = 0.75  # media seconds a seated table must look empty before the overlay says vacant
CHECK_AFTER_S = 1.0  # media seconds of vacancy before Gemini looks at a table
RECHECK_S = 4.0
MIN_CONFIDENCE = 0.4


def detect(model: str) -> dict:
    import cv2

    from turnwise.worker.detector import RfDetrDetector

    detector = RfDetrDetector(model, threshold=0.35)
    cap = cv2.VideoCapture(str(CLIP))
    fps = cap.get(cv2.CAP_PROP_FPS)
    samples, index = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index % 2 == 0:  # 12 samples per media second
            dets = detector.detect(frame)
            samples.append(
                {
                    "t": round(index / fps, 3),
                    "d": [[d.class_name, round(d.confidence, 3), [round(v, 1) for v in d.xyxy]]
                          for d in dets],
                }
            )
        index += 1
    return {"fps": fps, "frames": index, "model": detector.model_version, "samples": samples}


def smooth(statuses: list[tuple[float, str]]) -> list[str]:
    shown, away_since, out = None, None, []
    for t, raw in statuses:
        if raw == "occupied":
            shown, away_since = raw, None
        else:
            away_since = t if away_since is None else away_since
            if shown != "occupied" or t - away_since >= HOLD_S:
                shown = raw
        out.append(shown)
    return out


def gemini_checks(manifest: CameraManifest, rows: list[dict]) -> list[dict]:
    import cv2

    from turnwise import gemini
    from turnwise.contracts import TableCheckResult
    from turnwise.worker.table_check import PROMPT, PROMPT_VERSION, crop_table

    if not gemini.configured():
        print("GEMINI_API_KEY not set: timeline built without Gemini checks")
        return []
    from google.genai import types

    cap = cv2.VideoCapture(str(CLIP))
    checks = []
    for table in manifest.tables:
        since, last = None, None
        for row in rows:
            t, shown = row["t"], row["tables"][table.table_id][0]
            if shown != "vacant":
                since = None
                continue
            since = t if since is None else since
            if t - since < CHECK_AFTER_S or (last is not None and t - last < RECHECK_S):
                continue
            last = t
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            image = types.Part.from_bytes(
                data=crop_table(cv2, frame, table, scale=1), mime_type="image/jpeg"
            )
            try:
                result, model = gemini.generate([image, PROMPT], TableCheckResult)
            except gemini.GeminiUnavailable as err:
                print(f"  {table.table_id} @ {t:.2f}s skipped: {err}")
                continue
            checks.append(
                {"table_id": table.table_id, "t": t, "model": model,
                 "prompt_version": PROMPT_VERSION, **result.model_dump()}
            )
            print(f"  Gemini {model} {table.table_id} @ {t:.2f}s: {result.state} {result.items}")
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="rfdetr-medium")
    parser.add_argument("--detections", type=Path, help="reuse a saved detections JSON")
    parser.add_argument("--no-gemini", action="store_true")
    args = parser.parse_args()
    load_env()

    manifest = CameraManifest.model_validate_json((DEMO / "mixkit-manifest.json").read_text())
    data = json.loads(args.detections.read_text()) if args.detections else detect(args.model)

    raw: dict[str, list[tuple[float, str]]] = {t.table_id: [] for t in manifest.tables}
    per_sample = []
    for sample in data["samples"]:
        dets = [Detection(c, p, tuple(b)) for c, p, b in sample["d"] if p >= MIN_CONFIDENCE]
        evidence = frame_evidence(dets, manifest, None)
        per_sample.append((sample["t"], evidence))
        for table_id, ev in evidence.items():
            raw[table_id].append((sample["t"], ev.status.value))
    shown = {table_id: smooth(series) for table_id, series in raw.items()}

    rows = []
    for i, (t, evidence) in enumerate(per_sample):
        rows.append(
            {
                "t": t,
                "tables": {
                    table_id: [shown[table_id][i], ev.status.value, ev.seated,
                               sorted(ev.object_flags)]
                    for table_id, ev in evidence.items()
                },
            }
        )

    checks = [] if args.no_gemini else gemini_checks(manifest, rows)
    duration = data["frames"] / data["fps"]
    out = {
        "source": "Mixkit 4385 'Customers in a minimalist style restaurant' (time-lapse)",
        "detector": data["model"],
        "duration_s": round(duration, 3),
        "statuses": [s.value for s in VisualStatus],
        "row_format": ["shown_status", "raw_status", "seated", "object_flags"],
        "manifest": json.loads(manifest.model_dump_json()),
        "samples": rows,
        "gemini_checks": checks,
    }
    (DEMO / "mixkit-timeline.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {len(rows)} samples, {len(checks)} Gemini checks, {duration:.1f}s")


if __name__ == "__main__":
    main()
