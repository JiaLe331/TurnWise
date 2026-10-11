from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

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

app = FastAPI(title="TurnWise API", version="0.1.0")

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
