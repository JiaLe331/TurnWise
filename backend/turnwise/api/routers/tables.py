from fastapi import APIRouter

from turnwise.api.deps import ActorDep, IdempotencyKeyDep, ServicesDep
from turnwise.contracts import TableActionRequest, TableBoardEntry

router = APIRouter(prefix="/tables", tags=["tables"])


@router.post("/{table_id}/actions")
def table_action(
    table_id: str,
    request: TableActionRequest,
    actor: ActorDep,
    idempotency_key: IdempotencyKeyDep,
    services: ServicesDep,
) -> TableBoardEntry:
    return services.tables.act(table_id, request, actor, idempotency_key)
