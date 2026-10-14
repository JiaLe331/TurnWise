import asyncio
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from turnwise.gateway.replay import PreviewSlot

BOUNDARY = "frame"


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
