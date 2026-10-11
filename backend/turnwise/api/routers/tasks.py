from fastapi import APIRouter

from turnwise.api.deps import ActorDep, IdempotencyKeyDep, ServicesDep
from turnwise.contracts import TableBoardEntry, TaskActionRequest

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("/{task_id}/actions")
def task_action(
    task_id: str,
    request: TaskActionRequest,
    actor: ActorDep,
    idempotency_key: IdempotencyKeyDep,
    services: ServicesDep,
) -> TableBoardEntry:
    return services.tasks.act(task_id, request, actor, idempotency_key)
