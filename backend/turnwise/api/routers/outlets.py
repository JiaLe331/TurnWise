from fastapi import APIRouter

from turnwise.api.deps import ServicesDep
from turnwise.contracts import Board
from turnwise.domain.errors import NotFound

router = APIRouter(prefix="/outlets", tags=["outlets"])


@router.get("/{outlet_id}/board")
def get_board(outlet_id: str, services: ServicesDep) -> Board:
    if outlet_id != services.ctx.repo.outlet_id:
        raise NotFound(f"Outlet {outlet_id} does not exist.")
    return services.board()
