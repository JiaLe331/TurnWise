from fastapi import APIRouter

from turnwise.api.deps import GatewayDep, ServicesDep
from turnwise.contracts import ObservationSubmission, TableBoardEntry

router = APIRouter(prefix="/observations", tags=["observations"])


@router.post("")
def submit_observation(
    submission: ObservationSubmission, gateway: GatewayDep, services: ServicesDep
) -> TableBoardEntry:
    # observation_id is the idempotency key; changed content under one id is rejected.
    return services.observations.ingest(submission, gateway.camera_scope)
