import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from turnwise.api.deps import get_services
from turnwise.api.routers import (
    health,
    metrics,
    observations,
    outlets,
    parties,
    recommendations,
    seating,
    tables,
    tasks,
)
from turnwise.contracts import ApiError
from turnwise.domain.errors import DomainError
from turnwise.settings import load_env

load_env()  # settings are read lazily per request, so loading here is early enough

STALE_SWEEP_SECONDS = 5


async def _sweep_stale_cameras() -> None:
    while True:
        await asyncio.sleep(STALE_SWEEP_SECONDS)
        app.dependency_overrides.get(get_services, get_services)().sweep()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    sweeper = asyncio.create_task(_sweep_stale_cameras())
    yield
    sweeper.cancel()


app = FastAPI(title="TurnWise API", version="0.1.0", lifespan=lifespan)

for router in (
    health.router,
    observations.router,
    outlets.router,
    tables.router,
    tasks.router,
    parties.router,
    recommendations.router,
    seating.router,
    metrics.router,
):
    app.include_router(router)


@app.exception_handler(DomainError)
def handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
    body = ApiError(code=exc.code, message=exc.message)
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())
