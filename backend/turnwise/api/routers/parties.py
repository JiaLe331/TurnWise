from fastapi import APIRouter

from turnwise.api.deps import ActorDep, IdempotencyKeyDep, ServicesDep
from turnwise.contracts import CreatePartyRequest, PartyActionRequest, QueueParty
from turnwise.domain.seating import active_queue

router = APIRouter(prefix="/parties", tags=["parties"])


@router.get("")
def list_waitlist(services: ServicesDep) -> list[QueueParty]:
    """Waiting and held parties in queue order."""
    return active_queue(services.ctx)


@router.post("")
def create_party(
    request: CreatePartyRequest,
    actor: ActorDep,
    idempotency_key: IdempotencyKeyDep,
    services: ServicesDep,
) -> QueueParty:
    return services.waitlist.create(request, actor, idempotency_key)


@router.post("/{party_id}/actions")
def party_action(
    party_id: str,
    request: PartyActionRequest,
    actor: ActorDep,
    idempotency_key: IdempotencyKeyDep,
    services: ServicesDep,
) -> QueueParty:
    return services.waitlist.act(party_id, request, actor, idempotency_key)
