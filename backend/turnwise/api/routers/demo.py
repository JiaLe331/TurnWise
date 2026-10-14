from typing import Annotated, Literal

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from turnwise.demo import DEMO_TIME_SCALE, registry, timeline
from turnwise.domain.errors import NotFound
from turnwise.domain.services import Services

router = APIRouter(tags=["demo"])


class DemoSessionInfo(BaseModel):
    session_id: str
    mode: str
    duration_s: float
    time_scale: float
    camera_id: str
    camera_name: str


DemoMode = Literal["guided", "autoplay"]


class NewSession(BaseModel):
    mode: DemoMode = "guided"


class ModeChange(BaseModel):
    mode: DemoMode


class Tick(BaseModel):
    media_s: float = Field(ge=0)


class TickResult(BaseModel):
    media_s: float
    sim_now: str
    mode: DemoMode
    narration: list[dict]


def demo_services(x_demo_session: Annotated[str | None, Header()] = None) -> Services:
    session = registry.get(x_demo_session)
    if session is None:
        raise NotFound("Demo session expired. Start the demo again.", code="demo_session_expired")
    return session.services


@router.post("/sessions")
def create_session(body: NewSession | None = None) -> DemoSessionInfo:
    session = registry.create((body or NewSession()).mode)
    tl = timeline()
    return DemoSessionInfo(
        session_id=session.id,
        mode=session.mode,
        duration_s=tl.duration,
        time_scale=DEMO_TIME_SCALE,
        camera_id=tl.manifest.camera_id,
        camera_name=tl.manifest.name,
    )


@router.post("/sessions/{session_id}/tick")
def tick(session_id: str, body: Tick) -> TickResult:
    """The video player reports its position; the session replays evidence up to it."""
    session = registry.get(session_id)
    if session is None:
        raise NotFound("Demo session expired. Start the demo again.", code="demo_session_expired")
    with session.lock:
        session.advance(body.media_s)
        return _result(session)


@router.post("/sessions/{session_id}/mode")
def change_mode(session_id: str, body: ModeChange) -> TickResult:
    """Guided pauses for the viewer; autoplay lets the autopilot act from this point on."""
    session = registry.get(session_id)
    if session is None:
        raise NotFound("Demo session expired. Start the demo again.", code="demo_session_expired")
    with session.lock:
        session.set_mode(body.mode)
        return _result(session)


def _result(session) -> TickResult:
    return TickResult(
        media_s=session.media,
        sim_now=session.clock.now().isoformat(),
        mode=session.mode,
        narration=session.narration,
    )


@router.get("/timeline")
def get_timeline() -> dict:
    """Precomputed overlay data (table zones, per-sample states, Gemini checks)."""
    return timeline().raw
