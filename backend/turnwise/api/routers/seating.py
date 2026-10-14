from fastapi import APIRouter

from turnwise.api.deps import ActorDep, IdempotencyKeyDep, ServicesDep
from turnwise.contracts import CreateHoldRequest, HoldActionRequest, SeatingResult

router = APIRouter(prefix="/seating-holds", tags=["seating"])


@router.post("")
def create_hold(
    request: CreateHoldRequest,
    actor: ActorDep,
    idempotency_key: IdempotencyKeyDep,
    services: ServicesDep,
) -> SeatingResult:
    return services.seating.create_hold(request, actor, idempotency_key)


@router.post("/{hold_id}/actions")
def hold_action(
    hold_id: str,
    request: HoldActionRequest,
    actor: ActorDep,
    idempotency_key: IdempotencyKeyDep,
    services: ServicesDep,
) -> SeatingResult:
    return services.seating.act(hold_id, request, actor, idempotency_key)
