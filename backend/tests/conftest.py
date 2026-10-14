import os

# Tests never touch real Firestore: these win over the repository .env (loaded with setdefault).
os.environ["TURNWISE_STORAGE"] = "memory"
os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"] = ""
os.environ["GEMINI_API_KEY"] = ""  # no real Gemini calls from tests

from datetime import UTC, datetime

import pytest

from turnwise.contracts import (
    Actor,
    ActorType,
    TableAction,
    TableActionRequest,
    TaskAction,
    TaskActionRequest,
    UserRole,
)
from turnwise.domain.clock import FakeClock
from turnwise.domain.services import Services, build_services

ANA = Actor(actor_id="staff-ana", role=UserRole.FLOOR_STAFF)
BEN = Actor(actor_id="staff-ben", role=UserRole.FLOOR_STAFF)
MANAGER = Actor(actor_id="mgr-mei", role=UserRole.MANAGER)
HOST = Actor(actor_id="host-hal", role=UserRole.HOST)
MODEL = Actor(actor_id="gemini", actor_type=ActorType.MODEL)
SYSTEM = Actor(actor_id="observer", actor_type=ActorType.SYSTEM)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(datetime(2026, 10, 10, 18, 0, tzinfo=UTC))


@pytest.fixture
def services(clock: FakeClock) -> Services:
    return build_services(clock)


class Keys:
    def __init__(self) -> None:
        self._n = 0

    def __call__(self) -> str:
        self._n += 1
        return f"key-{self._n}"


@pytest.fixture
def key() -> Keys:
    return Keys()


def table_req(action: TableAction, version: int | None = None, **kwargs) -> TableActionRequest:
    return TableActionRequest(action=action, expected_version=version, **kwargs)


def task_req(action: TaskAction, **kwargs) -> TaskActionRequest:
    return TaskActionRequest(action=action, **kwargs)
