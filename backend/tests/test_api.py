from fastapi.testclient import TestClient

from turnwise.api.main import app
from turnwise.worker.main import app as worker_app


def test_health_endpoint() -> None:
    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_operational_mutations_are_not_exposed() -> None:
    response = TestClient(app).post("/parties", json={"queue_code": "A1", "size": 2})

    assert response.status_code == 404


def test_worker_health_endpoint() -> None:
    response = TestClient(worker_app).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
