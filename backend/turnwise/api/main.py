from fastapi import FastAPI

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
