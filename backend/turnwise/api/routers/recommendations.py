from fastapi import APIRouter

from turnwise.api.deps import ServicesDep
from turnwise.contracts import Recommendation

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("")
def get_recommendation(services: ServicesDep, party_id: str | None = None) -> Recommendation:
    """Up to three eligible tables for the oldest seatable party, or for `party_id`."""
    return services.seating.recommend(party_id)
