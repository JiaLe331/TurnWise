from datetime import timedelta
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import AwareDatetime

from turnwise.api.deps import ServicesDep
from turnwise.contracts import ShiftMetrics
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
