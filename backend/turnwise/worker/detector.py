"""RF-DETR adapter. Needs the optional `vision` dependency group."""

from turnwise.worker.evidence import Detection


class RfDetrDetector:
    def __init__(self, model_id: str = "rfdetr-nano", device: str | None = None, threshold=0.4):
        import torch
        from inference_models import AutoModel

        device = device or ("mps" if torch.backends.mps.is_available() else "cpu")
        self._model = AutoModel.from_pretrained(model_id, device=torch.device(device))
        # Class names come from the loaded checkpoint, never a hardcoded id table.
        self._names: list[str] = list(self._model.class_names)
        self.threshold = threshold
        self.device = device
        self.model_version = f"{model_id}@{device}"

    def detect_with_tiles(self, frame_bgr, tiles, scale: int = 2) -> list[Detection]:
        """Full frame plus each tile upscaled, mapped back to frame pixels. Duplicates between
        the passes are harmless: occupancy only asks whether any person sits in a seat area."""
        import cv2

        found = self.detect(frame_bgr)
        for x1, y1, x2, y2 in tiles:
            crop = cv2.resize(
                frame_bgr[y1:y2, x1:x2], None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
            )
            for det in self.detect(crop):
                bx1, by1, bx2, by2 = det.xyxy
                box = (bx1 / scale + x1, by1 / scale + y1, bx2 / scale + x1, by2 / scale + y1)
                found.append(Detection(det.class_name, det.confidence, box))
        return found

    def detect(self, frame_bgr) -> list[Detection]:
        result = self._model(frame_bgr, input_color_format="bgr")[0]
        return [
            Detection(self._names[cls], conf, tuple(box))
            for cls, conf, box in zip(
                result.class_id.tolist(), result.confidence.tolist(), result.xyxy.tolist()
            )
            if conf >= self.threshold
        ]
