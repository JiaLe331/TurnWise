import asyncio
import contextlib
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from turnwise.api.deps import get_services
from turnwise.api.routers import (
    demo,
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


def handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
    body = ApiError(code=exc.code, message=exc.message)
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


OUTLET_ROUTERS = (
    outlets.router,
    tables.router,
    tasks.router,
    parties.router,
    recommendations.router,
    seating.router,
    metrics.router,
)

app = FastAPI(title="TurnWise API", version="0.1.0", lifespan=lifespan)
for router in (health.router, observations.router, *OUTLET_ROUTERS):
    app.include_router(router)
app.add_exception_handler(DomainError, handle_domain_error)
# A frontend hosted on another origin (e.g. Vercel) calls the API directly; covers /demo too.
if cors_origins := os.environ.get("TURNWISE_CORS_ORIGIN_REGEX"):
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

# Live demo: the same outlet routes, scoped to a per-viewer session (X-Demo-Session) that replays
# the precomputed time-lapse on its own clock. Isolated from the live outlet above.
demo_app = FastAPI(title="TurnWise live demo", version="0.1.0")
for router in (demo.router, *OUTLET_ROUTERS):
    demo_app.include_router(router)
demo_app.add_exception_handler(DomainError, handle_domain_error)
demo_app.dependency_overrides[get_services] = demo.demo_services
app.mount("/demo", demo_app)
