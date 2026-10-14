import pytest
from fastapi.testclient import TestClient

from turnwise.api.deps import get_services
from turnwise.api.main import app
from turnwise.domain.services import build_services

STAFF = {"X-Actor-Id": "staff-ana", "X-Actor-Role": "floor_staff"}
HOST = {"X-Actor-Id": "host-hal", "X-Actor-Role": "host"}


@pytest.fixture
def client():
    services = build_services()
    app.dependency_overrides[get_services] = lambda: services
    yield TestClient(app)
    app.dependency_overrides.clear()


def _post(client, path, body, key, headers=STAFF):
    return client.post(path, json=body, headers={**headers, "Idempotency-Key": key})


def test_seeded_board_has_fourteen_tables_and_a_clearing_queue(client):
    board = client.get("/outlets/demo-outlet/board").json()
    assert len(board["tables"]) == 14
    assert [e["table"]["table_id"] for e in board["clearing_queue"]] == ["T4", "T5", "T11"]


def test_unknown_outlet_is_404_with_api_error(client):
    response = client.get("/outlets/other/board")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_full_cycle_through_http(client):
    r = _post(
        client, "/tables/T1/actions", {"action": "confirm_departure", "expected_version": 1}, "a"
    )
    assert r.status_code == 200
    task_id = r.json()["task"]["task_id"]

    assert _post(client, f"/tasks/{task_id}/actions", {"action": "claim"}, "b").status_code == 200
    assert _post(client, f"/tasks/{task_id}/actions", {"action": "start"}, "c").status_code == 200
    r = _post(client, "/tables/T1/actions", {"action": "mark_ready", "expected_version": 3}, "d")

    assert r.json()["session"]["operational_state"] == "ready"
    board = client.get("/outlets/demo-outlet/board").json()
    assert "T1" not in [e["table"]["table_id"] for e in board["clearing_queue"]]


def test_error_mapping(client):
    forbidden = _post(
        client,
        "/tables/T1/actions",
        {"action": "confirm_departure", "expected_version": 1},
        "x",
        HOST,
    )
    assert (forbidden.status_code, forbidden.json()["code"]) == (403, "forbidden")

    stale = _post(
        client, "/tables/T1/actions", {"action": "confirm_departure", "expected_version": 9}, "y"
    )
    assert (stale.status_code, stale.json()["code"]) == (409, "version_conflict")

    missing = _post(client, "/tables/T99/actions", {"action": "block", "reason": "x"}, "z")
    assert missing.status_code == 403  # block is manager-only, checked before lookup


def test_missing_identity_or_idempotency_headers_are_rejected(client):
    body = {"action": "confirm_departure", "expected_version": 1}
    assert (
        client.post("/tables/T1/actions", json=body, headers={"Idempotency-Key": "k"}).status_code
        == 422
    )
    assert client.post("/tables/T1/actions", json=body, headers=STAFF).status_code == 422
