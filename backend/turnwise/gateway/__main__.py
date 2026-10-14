"""Run the local 1x replay vision process: `uv run --group vision python -m turnwise.gateway`."""

import argparse
import logging
import os
from pathlib import Path

from turnwise.camera_manifest import DEFAULT_DIR, load_manifests

DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "recordings" / "restaurant-cctv-sample.mp4"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--camera", default="cctv-01")
    parser.add_argument("--model", default=os.environ.get("TURNWISE_DETECTOR_MODEL", "rfdetr-nano"))
    parser.add_argument("--device", default=os.environ.get("TURNWISE_DETECTOR_DEVICE"))
    parser.add_argument(
        "--api", default=os.environ.get("TURNWISE_API_URL", "http://127.0.0.1:8000")
    )
    parser.add_argument("--no-publish", action="store_true", help="preview only, no API writes")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    if not args.source.is_file():
        raise SystemExit(f"Recording not found: {args.source}")
    manifest = next((m for m in load_manifests() if m.camera_id == args.camera), None)
    if manifest is None:
        raise SystemExit(f"No mapping for {args.camera} in {DEFAULT_DIR}")
    token = os.environ.get("TURNWISE_GATEWAY_TOKEN")
    if not args.no_publish and not token:
        raise SystemExit("Set TURNWISE_GATEWAY_TOKEN (same value as the API) or pass --no-publish.")

    import uvicorn

    from turnwise.gateway.publisher import ObservationPublisher
    from turnwise.gateway.replay import PreviewSlot, ReplayRunner
    from turnwise.worker.detector import RfDetrDetector
    from turnwise.worker.main import create_app

    detector = RfDetrDetector(args.model, args.device)
    publisher = None if args.no_publish else ObservationPublisher(args.api, token)
    slot = PreviewSlot()
    runner = ReplayRunner(args.source, manifest, detector, publisher, slot)
    runner.start()
    try:
        uvicorn.run(create_app({manifest.camera_id: slot}), host="127.0.0.1", port=args.port)
    finally:
        runner.stop()
        if publisher is not None:
            publisher.close()


if __name__ == "__main__":
    main()
