import asyncio
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse

from turnwise.gateway.replay import PreviewSlot

BOUNDARY = "frame"
WALL_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TurnWise cameras</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; background: #0b0b0c; color: #d6d6d6;
         font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
         display: grid; place-items: center; }
  main { width: min(1400px, calc(100vw - 32px)); padding: 16px; border-radius: 22px;
         background: #1a1a1c; box-shadow: 0 30px 80px #000a; }
  .wall { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
  figure { margin: 0; background: #000; border-radius: 12px; overflow: hidden; }
  img { display: block; width: 100%; aspect-ratio: 848 / 480; object-fit: contain; }
  figcaption { padding: 8px 12px; color: #9a9a9a; }
  @media (max-width: 480px) { .wall { grid-template-columns: 1fr; } }
</style></head>
<body><main><div class="wall">{tiles}</div></main>
<script>
  const tick = async () => {
    for (const fig of document.querySelectorAll("figure[data-cam]")) {
      try {
        const m = await (await fetch(`/preview/cameras/${fig.dataset.cam}`)).json();
        const age = m.frame_age_s == null ? "" : ` · frame age ${m.frame_age_s}s`;
        const fps = m.measured_fps ? ` · ${m.measured_fps} fps` : "";
        fig.querySelector("figcaption").textContent =
          `${m.camera_name ?? fig.dataset.cam} · ${m.status}${fps}${age}`;
      } catch { fig.querySelector("figcaption").textContent = "Preview unavailable"; }
    }
  };
  tick(); setInterval(tick, 2000);
</script></body></html>"""


def create_app(slots: dict[str, PreviewSlot] | None = None) -> FastAPI:
    """Vision-process HTTP shell. `slots` are filled by replay runners in this same process."""
    slots = slots if slots is not None else {}
    app = FastAPI(title="TurnWise Observation Worker", version="0.1.0")

    def slot_for(camera_id: str) -> PreviewSlot:
        slot = slots.get(camera_id)
        if slot is None:
            raise HTTPException(404, f"No preview for camera {camera_id}.")
        return slot

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/preview", response_class=HTMLResponse)
    def camera_wall() -> str:
        """Dark camera wall: one live tile per camera, with processing status under each."""
        tiles = "".join(
            f'<figure data-cam="{cam}"><img src="/preview/cameras/{cam}/stream" alt="{cam} '
            f'annotated replay"><figcaption>Connecting…</figcaption></figure>'
            for cam in slots
        )
        return WALL_HTML.replace("{tiles}", tiles or "<p>No cameras configured.</p>")

    @app.get("/preview/cameras/{camera_id}")
    def preview_status(camera_id: str) -> dict:
        return slot_for(camera_id).snapshot()

    @app.get("/preview/cameras/{camera_id}/stream")
    async def preview_stream(camera_id: str) -> StreamingResponse:
        slot = slot_for(camera_id)

        async def frames() -> AsyncIterator[bytes]:
            seq = 0
            while True:
                # Thread wait keeps the event loop free; a disconnect cancels this generator.
                seq, jpeg = await asyncio.to_thread(slot.wait_newer, seq, 1.0)
                if jpeg is None:
                    continue
                yield (
                    (
                        f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                        f"Content-Length: {len(jpeg)}\r\n\r\n"
                    ).encode()
                    + jpeg
                    + b"\r\n"
                )

        return StreamingResponse(
            frames(),
            media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            headers={"Cache-Control": "no-store"},
        )

    return app


app = create_app()
