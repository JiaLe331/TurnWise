from datetime import timedelta
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import AwareDatetime, BaseModel, Field

from turnwise.api.deps import ServicesDep
from turnwise.contracts import ShiftMetrics
from turnwise.domain import assistant
from turnwise.domain.briefing import ShiftAnswer, ShiftBriefing, ShiftInsights
from turnwise.domain.errors import BadRequest, NotFound
from turnwise.domain.metrics import shift_metrics, to_csv

router = APIRouter(tags=["metrics"])
DEFAULT_WINDOW = timedelta(hours=12)
MAX_WINDOW = timedelta(days=31)


@router.get("/outlets/{outlet_id}/metrics", response_model=None)
def get_metrics(
    outlet_id: str,
    services: ServicesDep,
    start: AwareDatetime | None = None,
    end: AwareDatetime | None = None,
    format: Literal["json", "csv"] = "json",
) -> ShiftMetrics | PlainTextResponse:
    """Shift metrics for [start, end), default the last 12 hours. `format=csv` exports rows."""
    if outlet_id != services.ctx.repo.outlet_id:
        raise NotFound(f"Outlet {outlet_id} does not exist.")
    end = end or services.ctx.clock.now()
    start = start or end - DEFAULT_WINDOW
    if not start < end or end - start > MAX_WINDOW:
        raise BadRequest("Window must satisfy start < end and span at most 31 days.")
    metrics = shift_metrics(services.ctx, start, end)
    if format == "csv":
        filename = f"turnwise-{outlet_id}-{start:%Y%m%dT%H%M}.csv"
        return PlainTextResponse(
            to_csv(metrics),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return metrics


@router.get("/outlets/{outlet_id}/briefing")
def get_briefing(
    outlet_id: str,
    services: ServicesDep,
    start: AwareDatetime | None = None,
    end: AwareDatetime | None = None,
) -> ShiftBriefing:
    """Gemini-written manager briefing from the shift facts (cached 2 minutes per window)."""
    if outlet_id != services.ctx.repo.outlet_id:
        raise NotFound(f"Outlet {outlet_id} does not exist.")
    end = end or services.ctx.clock.now()
    start = start or end - DEFAULT_WINDOW
    if not start < end or end - start > MAX_WINDOW:
        raise BadRequest("Window must satisfy start < end and span at most 31 days.")
    return services.briefing.generate(start, end)


def _window(services, start, end):
    end = end or services.ctx.clock.now()
    start = start or end - DEFAULT_WINDOW
    if not start < end or end - start > MAX_WINDOW:
        raise BadRequest("Window must satisfy start < end and span at most 31 days.")
    return start, end


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=300)


@router.post("/outlets/{outlet_id}/ask")
def ask_shift(outlet_id: str, body: Question, services: ServicesDep) -> ShiftAnswer:
    """Gemini answers a manager's question from the shift facts only."""
    if outlet_id != services.ctx.repo.outlet_id:
        raise NotFound(f"Outlet {outlet_id} does not exist.")
    return services.briefing.ask(body.question.strip(), *_window(services, None, None))


@router.get("/outlets/{outlet_id}/insights")
def get_insights(
    outlet_id: str,
    services: ServicesDep,
    start: AwareDatetime | None = None,
    end: AwareDatetime | None = None,
) -> ShiftInsights:
    """Gemini efficiency recommendations from bottlenecks in the shift facts (cached 2 min)."""
    if outlet_id != services.ctx.repo.outlet_id:
        raise NotFound(f"Outlet {outlet_id} does not exist.")
    return services.briefing.insights(*_window(services, start, end))


class ChatRequest(BaseModel, extra="ignore"):
    messages: list[dict]


@router.post("/outlets/{outlet_id}/assistant")
def chat(outlet_id: str, body: ChatRequest, services: ServicesDep) -> StreamingResponse:
    """Shift assistant chat, streamed in the Vercel AI SDK UI message stream protocol."""
    if outlet_id != services.ctx.repo.outlet_id:
        raise NotFound(f"Outlet {outlet_id} does not exist.")
    assistant.validate(body.messages)
    return StreamingResponse(
        assistant.chat_stream(services.ctx, body.messages, services.ctx.clock.now()),
        media_type="text/event-stream",
        headers=assistant.STREAM_HEADERS,
    )
