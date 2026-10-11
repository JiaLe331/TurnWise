from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Header

from turnwise.contracts import Actor, UserRole
from turnwise.domain.services import Services, build_services


@lru_cache
def get_services() -> Services:
    return build_services()


def get_actor(
    x_actor_id: Annotated[str, Header(min_length=1)],
    x_actor_role: Annotated[UserRole, Header()],
) -> Actor:
    # Temporary header identity until Firebase Auth supplies verified outlet roles.
    return Actor(actor_id=x_actor_id, role=x_actor_role)


def get_idempotency_key(idempotency_key: Annotated[str, Header(min_length=1)]) -> str:
    return idempotency_key


ServicesDep = Annotated[Services, Depends(get_services)]
ActorDep = Annotated[Actor, Depends(get_actor)]
IdempotencyKeyDep = Annotated[str, Depends(get_idempotency_key)]
