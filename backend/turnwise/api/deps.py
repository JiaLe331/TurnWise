import json
import os
import secrets
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Header

from turnwise.camera_manifest import load_manifests
from turnwise.contracts import Actor, UserRole
from turnwise.domain.errors import DomainError
from turnwise.domain.services import DEMO_OUTLET_ID, Services, build_services


@lru_cache
def get_services() -> Services:
    repo = None
    if os.environ.get("TURNWISE_STORAGE", "memory") == "firestore":
        from google.cloud import firestore

        from turnwise.domain.firestore_repository import FirestoreRepository

        repo = FirestoreRepository(DEMO_OUTLET_ID, _firestore_client(firestore))
        repo.load()
    return build_services(camera_manifests=load_manifests(), repo=repo)


def _firestore_client(firestore):
    """FIREBASE_SERVICE_ACCOUNT_JSON (the key file's JSON, one line) if set; otherwise the default
    Google credentials, GOOGLE_APPLICATION_CREDENTIALS, or the emulator."""
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not raw:
        return firestore.Client()
    from google.oauth2 import service_account

    info = json.loads(raw)
    credentials = service_account.Credentials.from_service_account_info(info)
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or info["project_id"]
    return firestore.Client(project=project, credentials=credentials)


class Unauthorized(DomainError):
    status_code = 401
    code = "unauthorized"


@dataclass(frozen=True)
class GatewayCredential:
    camera_scope: str | None


def get_gateway(authorization: Annotated[str | None, Header()] = None) -> GatewayCredential:
    # Local service token until A supplies service authentication. Never a human header identity.
    expected = os.environ.get("TURNWISE_GATEWAY_TOKEN")
    if not expected:
        raise Unauthorized("Gateway token is not configured on this API.", code="gateway_disabled")
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(token, expected):
        raise Unauthorized("Invalid gateway credential.")
    return GatewayCredential(camera_scope=os.environ.get("TURNWISE_GATEWAY_CAMERA") or None)


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
GatewayDep = Annotated[GatewayCredential, Depends(get_gateway)]
