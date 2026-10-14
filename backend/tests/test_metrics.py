from conftest import ANA, HOST, SYSTEM, table_req, task_req
from fastapi.testclient import TestClient

from turnwise.api.deps import get_services
from turnwise.api.main import app
from turnwise.contracts import (
    CreateHoldRequest,
    CreatePartyRequest,
    HoldAction,
    HoldActionRequest,
    TableAction,
    TaskAction,
)
from turnwise.domain.metrics import shift_metrics


def run_cycle(services, clock, key):
    """Party waits; T1 vision review dismissed, later re-reviewed, confirmed, cleaned, seated."""
    party = services.waitlist.create(CreatePartyRequest(queue_code="A1", size=2), HOST, key())
    services.tables.act("T1", table_req(TableAction.REQUEST_DEPARTURE_REVIEW, 1), SYSTEM, key())
    services.tables.act("T1", table_req(TableAction.DISMISS_REVIEW, 2), ANA, key())
    services.tables.act("T1", table_req(TableAction.REQUEST_DEPARTURE_REVIEW, 3), SYSTEM, key())
    clock.advance(seconds=30)
    entry = services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 4), ANA, key())
    task_id = entry.task.task_id
    services.tasks.act(task_id, task_req(TaskAction.CLAIM), ANA, key())
    services.tasks.act(task_id, task_req(TaskAction.START), ANA, key())
    clock.advance(minutes=7)
    services.tables.act("T1", table_req(TableAction.MARK_READY, 6), ANA, key())
    clock.advance(minutes=2)
    # Host seats the waiting party at the table that was just readied.
    held = services.seating.create_hold(
        CreateHoldRequest(party_id=party.party_id, table_id="T1", party_version=1, table_version=7),
        HOST,
        key(),
    )
    services.seating.act(
        held.hold.hold_id,
        HoldActionRequest(action=HoldAction.CONFIRM, expected_version=1),
        HOST,
        key(),
    )


def test_metrics_trace_to_events(services, clock, key):
    start = clock.now()
    run_cycle(services, clock, key)
    m = shift_metrics(services.ctx, start, clock.now() + clock.now().resolution)
    durations = {d.metric: d for d in m.durations}
    assert durations["confirmed_departure_to_ready"].median_s == 420
    assert durations["review_to_confirmation"].median_s == 30
    assert durations["ready_to_seated"].median_s == 120
    assert durations["queue_wait"].median_s == 570
    assert m.queue_wait_by_size[2].count == 1
    assert m.counts["vision_reviews"] == 2
    assert m.counts["party_seated"] == 1
    assert m.vision_review_correction_rate == 0.5  # one dismissed, one confirmed


def test_empty_window_and_csv_export(services, clock, key):
    app.dependency_overrides[get_services] = lambda: services
    try:
        client = TestClient(app)
        empty = client.get("/outlets/demo-outlet/metrics").json()
        assert all(d["count"] == 0 for d in empty["durations"])
        assert empty["vision_review_correction_rate"] is None

        run_cycle(services, clock, key)
        csv = client.get("/outlets/demo-outlet/metrics", params={"format": "csv"})
        assert csv.headers["content-type"].startswith("text/csv")
        lines = csv.text.splitlines()
        assert lines[0] == "metric,table_id,party_id,session_id,started_at,ended_at,value"
        assert any(line.startswith("confirmed_departure_to_ready,T1,") for line in lines)
        assert client.get("/outlets/other/metrics").status_code == 404
        bad = client.get(
            "/outlets/demo-outlet/metrics",
            params={"start": "2026-10-10T18:00:00Z", "end": "2026-10-10T17:00:00Z"},
        )
        assert bad.status_code == 422
    finally:
        app.dependency_overrides.clear()
