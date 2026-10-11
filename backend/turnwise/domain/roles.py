from turnwise.contracts import Actor, ActorType, UserRole
from turnwise.domain.errors import Forbidden

STAFF = frozenset({UserRole.FLOOR_STAFF, UserRole.MANAGER})
MANAGER = frozenset({UserRole.MANAGER})

PERMISSIONS: dict[str, frozenset[UserRole]] = {
    "request_departure_review": STAFF,
    "dismiss_review": STAFF,
    "confirm_departure": STAFF,
    "mark_ready": STAFF,
    "override_state": MANAGER,
    "release_override": STAFF,
    "block": MANAGER,
    "unblock": MANAGER,
    "claim_task": STAFF,
    "start_task": STAFF,
    "release_task": STAFF,
    "complete_task": STAFF,
    "cancel_task": MANAGER,
}

SYSTEM_ACTIONS = frozenset({"request_departure_review"})


def require(actor: Actor, action: str) -> None:
    if actor.actor_type is ActorType.MODEL:
        raise Forbidden(
            "Model output cannot change operational state.", code="model_not_authorized"
        )
    if actor.actor_type is ActorType.SYSTEM:
        if action in SYSTEM_ACTIONS:
            return
        raise Forbidden(f"System actors cannot perform {action}.", code="system_not_authorized")
    if actor.role not in PERMISSIONS[action]:
        raise Forbidden(f"Role {actor.role} cannot perform {action}.")


def is_manager(actor: Actor) -> bool:
    return actor.role is UserRole.MANAGER
