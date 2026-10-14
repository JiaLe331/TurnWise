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

    def detect(self, frame_bgr) -> list[Detection]:
        result = self._model(frame_bgr, input_color_format="bgr")[0]
        return [
            Detection(self._names[cls], conf, tuple(box))
            for cls, conf, box in zip(
                result.class_id.tolist(), result.confidence.tolist(), result.xyxy.tolist()
            )
            if conf >= self.threshold
        ]
