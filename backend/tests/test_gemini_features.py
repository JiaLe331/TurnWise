from datetime import timedelta

import pytest
from conftest import HOST
from fastapi.testclient import TestClient

from turnwise import gemini
from turnwise.api.deps import get_services
from turnwise.api.main import app
from turnwise.camera_manifest import CameraManifest, TableRegion
from turnwise.contracts import (
    CreatePartyRequest,
    ObservationSubmission,
    OperationalState,
    TableCheck,
    VisualStatus,
)
from turnwise.domain.briefing import Briefing
from turnwise.domain.services import build_services
from turnwise.gateway.replay import ReplayRunner
from turnwise.worker.evidence import Summary

SQUARE = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]


@pytest.fixture
def services(clock):
    manifest = CameraManifest(
        outlet_id="demo-outlet",
        camera_id="cctv-01",
        name="C",
        configuration_version=1,
        width=10,
        height=10,
        tables=[TableRegion(table_id=t, tabletop=SQUARE, seats=[SQUARE]) for t in ("T1", "T6")],
    )
    return build_services(clock, camera_manifests=[manifest])


def check(clock, state="leftovers", seconds_ago=0, people=False):
    return TableCheck(
        people_present=people,
        state=state,
        items=["used plates"] if state == "leftovers" else [],
        reason="plates on table",
        checked_at=clock.now() - timedelta(seconds=seconds_ago),
        model="gemini-test",
        prompt_version="table-check-v1",
    )


def observe(services, clock, table_id, seq, table_check=None):
    now = clock.now()
    return services.observations.ingest(
        ObservationSubmission(
            observation_id=f"o{seq}",
            frame_id="f",
            outlet_id="demo-outlet",
            camera_id="cctv-01",
            table_id=table_id,
            configuration_version=1,
            stream_id="run",
            gateway_sequence=seq,
            interval_started_at=now,
            observed_at=now,
            continuous_valid_coverage=True,
            occupied_seen=False,
            unclear_seen=False,
            visual_status=VisualStatus.VACANT,
            occlusion=False,
            source_mode="replay",
            model_version="m",
            policy_version="p",
            table_check=table_check,
        ),
        None,
    )


def alerts(services):
    return [
        e for e in services.ctx.repo.list_events() if e.event_type == "ready_table_leftovers_seen"
    ]


def test_leftovers_on_ready_table_alert_once_and_never_change_state(services, clock):
    first = check(clock)
    entry = observe(services, clock, "T6", 1, first)
    assert entry.session.operational_state is OperationalState.READY
    assert entry.evidence.table_check.state == "leftovers"
    observe(services, clock, "T6", 2, first)  # same answer re-sent
    clock.advance(seconds=5)
    observe(services, clock, "T6", 3, check(clock, state="clear_and_set"))
    assert len(alerts(services)) == 1
    assert "used plates" in alerts(services)[0].reason


def test_old_or_people_checks_do_not_alert(services, clock, key):
    observe(services, clock, "T6", 1, check(clock, people=True))
    assert alerts(services) == []
    # A check taken before the table was last marked ready is ignored for alerts.
    session = services.ctx.repo.get_session("T6")
    assert session.ready_at < clock.now()
    observe(services, clock, "T6", 2, check(clock, seconds_ago=1e6))
    assert alerts(services) == []


def test_occupied_table_check_is_evidence_only(services, clock):
    entry = observe(services, clock, "T1", 1, check(clock))
    assert entry.session.operational_state is OperationalState.OCCUPIED
    assert alerts(services) == []


def test_gateway_sends_each_check_once(clock):
    sent = []

    class Publisher:
        def publish(self, sub):
            sent.append(sub)

    class Checker:
        def latest(self, table_id):
            return check(clock)

    class Detector:
        model_version = "m"

    runner = ReplayRunner.__new__(ReplayRunner)
    runner.publisher, runner.checker, runner.detector = Publisher(), Checker(), Detector()
    runner._seq, runner._sent_checks, runner.run_id, runner.recording_id = 0, {}, "r", "rec"
    runner.manifest = CameraManifest(
        outlet_id="o",
        camera_id="c",
        name="C",
        configuration_version=1,
        width=1,
        height=1,
        tables=[],
    )
    summary = Summary(
        "T6", clock.now(), clock.now(), 0.0, True, False, False, VisualStatus.VACANT, [], []
    )
    runner._publish(summary)
    runner._publish(summary)
    assert sent[0].table_check is not None and sent[0].prompt_version == "table-check-v1"
    assert sent[1].table_check is None


@pytest.fixture
def client(services):
    app.dependency_overrides[get_services] = lambda: services
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_briefing_uses_facts_and_caches(client, services, monkeypatch, key):
    calls = []

    def fake_generate(contents, schema):
        calls.append(contents)
        return schema(
            headline="Steady shift", highlights=["1 party waiting"], suggestions=["Clear T4 first"]
        ), "gemini-test"

    monkeypatch.setattr(gemini, "generate", fake_generate)
    services.waitlist.create(CreatePartyRequest(queue_code="A1", size=4), HOST, key())
    first = client.get("/outlets/demo-outlet/briefing")
    assert first.status_code == 200
    body = first.json()
    assert body["briefing"]["headline"] == "Steady shift"
    assert body["model"] == "gemini-test" and body["ai_generated"] is True
    assert body["facts"]["waiting_parties"][0]["code"] == "A1"
    assert '"A1"' in calls[0][1]  # Gemini only sees the computed facts
    assert client.get("/outlets/demo-outlet/briefing").status_code == 200
    assert len(calls) == 1  # cached


def test_briefing_without_gemini_is_503(client):
    r = client.get("/outlets/demo-outlet/briefing")
    assert r.status_code == 503
    assert r.json()["code"] == "ai_unavailable"


def test_briefing_schema_bounds():
    with pytest.raises(ValueError):
        Briefing(headline="x", highlights=["a"] * 6, suggestions=[])


def test_ask_and_insights_ground_in_facts(client, monkeypatch):
    seen = []

    def fake_generate(contents, schema):
        seen.append(contents)
        if schema.__name__ == "Answer":
            return schema(
                answer="Two tasks are unclaimed.",
                facts_used=["unclaimed_clearing_tasks"],
                answerable=True,
            ), "gemini-test"
        return schema(
            recommendations=[
                {
                    "title": "Assign a runner",
                    "evidence": "2 unclaimed tasks",
                    "expected_impact": "Faster clearing",
                    "effort": "low",
                }
            ]
        ), "gemini-test"

    monkeypatch.setattr(gemini, "generate", fake_generate)
    r = client.post("/outlets/demo-outlet/ask", json={"question": "What is unclaimed?"})
    assert r.status_code == 200 and r.json()["result"]["answerable"] is True
    assert "QUESTION: What is unclaimed?" in seen[0][1]
    r = client.get("/outlets/demo-outlet/insights")
    assert r.json()["insights"]["recommendations"][0]["effort"] == "low"
    assert client.post("/outlets/demo-outlet/ask", json={"question": "x"}).status_code == 422


def test_gemini_leftovers_pause_recommendation_until_verified(services, clock, key):
    services.waitlist.create(CreatePartyRequest(queue_code="A1", size=2), HOST, key())
    observe(services, clock, "T6", 1)
    assert "T6" in [t.table_id for t in services.seating.recommend().tables]
    observe(services, clock, "T6", 2, check(clock))
    rec = services.seating.recommend()
    assert "T6" not in [t.table_id for t in rec.tables]
    assert any("Gemini" in s.reason for s in rec.skipped) or rec.tables
