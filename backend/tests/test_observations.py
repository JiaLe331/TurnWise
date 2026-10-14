from datetime import timedelta

import pytest
from conftest import ANA, MANAGER, table_req
from fastapi.testclient import TestClient

from turnwise.api.deps import get_services
from turnwise.api.main import app
from turnwise.camera_manifest import CameraManifest, TableRegion
from turnwise.contracts import (
    ObservationSubmission,
    OperationalState,
    TableAction,
    TaskAction,
    TaskActionRequest,
    TaskStatus,
    VisualStatus,
)
from turnwise.domain.errors import Forbidden, IdempotencyConflict, InvalidTransition
from turnwise.domain.services import build_services

SQUARE = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]
MANIFEST = CameraManifest(
    outlet_id="demo-outlet",
    camera_id="cctv-01",
    name="CCTV 01",
    configuration_version=3,
    width=848,
    height=480,
    tables=[TableRegion(table_id=t, tabletop=SQUARE, seats=[SQUARE]) for t in ("T1", "T6", "T7")],
)


@pytest.fixture
def services(clock):
    return build_services(clock, camera_manifests=[MANIFEST])


class Feed:
    """Gateway stand-in: contiguous interval summaries on the fake clock."""

    def __init__(self, services, clock, table_id="T1", stream_id="run-1"):
        self.services, self.clock, self.table_id, self.stream_id = (
            services,
            clock,
            table_id,
            stream_id,
        )
        self.seq = 0
        self.last = clock.now()

    def make(self, seconds=10.0, status=VisualStatus.VACANT, **overrides):
        self.clock.advance(seconds=seconds)
        start, end = self.last, self.clock.now()
        self.last = end
        self.seq += 1
        fields = {
            "observation_id": f"{self.stream_id}-{self.table_id}-{self.seq}",
            "frame_id": f"f{self.seq}",
            "outlet_id": "demo-outlet",
            "camera_id": "cctv-01",
            "table_id": self.table_id,
            "configuration_version": 3,
            "stream_id": self.stream_id,
            "gateway_sequence": self.seq,
            "interval_started_at": start,
            "observed_at": end,
            "continuous_valid_coverage": True,
            "occupied_seen": status is VisualStatus.OCCUPIED,
            "unclear_seen": status is VisualStatus.UNCLEAR,
            "visual_status": status,
            "object_flags": [],
            "occlusion": False,
            "source_mode": "replay",
            "recording_id": "restaurant-cctv-sample",
            "media_offset_s": 0.0,
            "model_version": "rfdetr-nano",
            "policy_version": "v1",
        }
        fields.update(overrides)
        return ObservationSubmission(**fields)

    def send(self, *args, **kwargs):
        return self.services.observations.ingest(self.make(*args, **kwargs), None)


def state(services, table_id="T1"):
    return services.ctx.repo.get_session(table_id).operational_state


def events(services, kind, table_id="T1"):
    return [e for e in services.ctx.repo.list_events(table_id) if e.event_type == kind]


def test_three_rapid_frames_and_0_10_20_do_not_request_review(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)  # first valid frame
    for _ in range(3):
        feed.send(seconds=0.2)
    feed.send(seconds=9.4)
    feed.send()
    assert state(services) is OperationalState.OCCUPIED


def test_valid_0_10_20_30_requests_exactly_one_review(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    for _ in range(3):
        entry = feed.send()
    assert entry.session.operational_state is OperationalState.DEPARTURE_REVIEW
    assert entry.evidence.review_source == "observation"
    entry = feed.send()
    assert entry.session.operational_state is OperationalState.DEPARTURE_REVIEW
    assert len(events(services, "departure_review_requested")) == 1
    assert entry.task is None


def test_exactly_30_seconds_qualifies_and_just_below_does_not(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    feed.send(seconds=29.999)
    assert state(services) is OperationalState.OCCUPIED
    feed.send(seconds=0.001)
    assert state(services) is OperationalState.DEPARTURE_REVIEW


def test_person_between_summaries_interrupts_vacancy(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    feed.send()
    # Guest appeared at 14s and left at 17s: the 10-20 summary carries occupied_seen.
    feed.send(status=VisualStatus.VACANT, occupied_seen=True)
    feed.send()
    feed.send()
    assert state(services) is OperationalState.OCCUPIED
    feed.send()
    feed.send()
    assert state(services) is OperationalState.DEPARTURE_REVIEW


@pytest.mark.parametrize(
    "overrides",
    [
        {"continuous_valid_coverage": False},
        {"occlusion": True},
        {"status": VisualStatus.UNCLEAR},
    ],
)
def test_unclear_or_uncovered_evidence_never_counts_as_vacancy(services, clock, overrides):
    feed = Feed(services, clock)
    for _ in range(6):
        feed.send(**overrides)
    assert state(services) is OperationalState.OCCUPIED
    assert services.ctx.repo.get_session("T1").last_valid_observation_at is None


def test_coverage_gap_resets_continuity(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    feed.send()
    feed.send()
    clock.advance(seconds=3)  # 3s hole between summaries > 2s gap limit
    feed.last = clock.now()
    feed.send()
    assert state(services) is OperationalState.OCCUPIED
    feed.send()
    feed.send()
    assert state(services) is OperationalState.DEPARTURE_REVIEW


def test_duplicate_delivery_is_idempotent_and_changed_content_rejected(services, clock):
    feed = Feed(services, clock)
    sub = feed.make(seconds=0)
    services.observations.ingest(sub, None)
    services.observations.ingest(sub, None)
    assert len(services.ctx.repo.list_observations("T1")) == 1
    with pytest.raises(IdempotencyConflict):
        services.observations.ingest(sub.model_copy(update={"occlusion": True}), None)


def test_reordered_old_run_and_old_mapping_are_rejected(services, clock):
    feed = Feed(services, clock)
    first = feed.make(seconds=0)
    second = feed.make()
    services.observations.ingest(second, None)
    with pytest.raises(InvalidTransition):
        services.observations.ingest(first, None)

    new_run = Feed(services, clock, stream_id="run-2")
    new_run.send(seconds=0)
    with pytest.raises(InvalidTransition):
        feed.send()  # delayed result from the replaced run
    with pytest.raises(InvalidTransition):
        new_run.send(configuration_version=2)


def test_unmapped_camera_and_wrong_scope_are_forbidden(services, clock):
    with pytest.raises(Forbidden):
        Feed(services, clock, table_id="T2").send(seconds=0)
    with pytest.raises(Forbidden):
        services.observations.ingest(Feed(services, clock).make(seconds=0), "cctv-02")


def test_future_and_too_old_observations_are_rejected(services, clock):
    feed = Feed(services, clock)
    sub = feed.make(seconds=0)
    clock.advance(minutes=11)
    with pytest.raises(InvalidTransition):
        services.observations.ingest(sub, None)
    future = feed.make(seconds=0).model_copy(
        update={"observed_at": clock.now() + timedelta(seconds=6)}
    )
    with pytest.raises(Exception, match="future"):
        services.observations.ingest(future, None)


def test_dismissal_invalidates_prior_vacancy_including_delayed_results(services, clock, key):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    for _ in range(3):
        feed.send()
    assert state(services) is OperationalState.DEPARTURE_REVIEW
    delayed = feed.make()  # interval began before the dismissal
    version = services.ctx.repo.get_session("T1").state_version
    services.tables.act("T1", table_req(TableAction.DISMISS_REVIEW, version), ANA, key())
    with pytest.raises(InvalidTransition):
        services.observations.ingest(delayed, None)
    feed.last = clock.now()
    feed.send(seconds=0)
    feed.send()
    feed.send()
    assert state(services) is OperationalState.OCCUPIED
    feed.send()
    assert state(services) is OperationalState.DEPARTURE_REVIEW


def test_manual_override_locks_automatic_review(services, clock, key):
    version = services.ctx.repo.get_session("T7").state_version
    services.tables.act(
        "T7",
        table_req(TableAction.OVERRIDE_STATE, version, target_state="needs_clearing", reason="x"),
        MANAGER,
        key(),
    )
    version = services.ctx.repo.get_session("T7").state_version
    services.tables.act(
        "T7",
        table_req(TableAction.OVERRIDE_STATE, version, target_state="occupied", reason="back"),
        MANAGER,
        key(),
    )
    feed = Feed(services, clock, table_id="T7")
    feed.send(seconds=0)
    for _ in range(5):
        feed.send()
    assert state(services, "T7") is OperationalState.OCCUPIED


def test_guest_return_withdraws_vision_review_without_task(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    for _ in range(3):
        feed.send()
    entry = feed.send(status=VisualStatus.OCCUPIED)
    assert entry.session.operational_state is OperationalState.OCCUPIED
    assert entry.session.party_id is not None
    assert entry.task is None
    assert len(events(services, "departure_review_withdrawn")) == 1


def test_guest_return_does_not_withdraw_staff_requested_review(services, clock, key):
    services.tables.act("T1", table_req(TableAction.REQUEST_DEPARTURE_REVIEW, 1), ANA, key())
    Feed(services, clock).send(seconds=0, status=VisualStatus.OCCUPIED)
    assert state(services) is OperationalState.DEPARTURE_REVIEW


def test_occupancy_on_ready_table_raises_blocker_once(services, clock):
    feed = Feed(services, clock, table_id="T6")
    feed.send(seconds=0, status=VisualStatus.OCCUPIED)
    feed.send(status=VisualStatus.OCCUPIED)
    assert state(services, "T6") is OperationalState.READY
    assert len(events(services, "occupancy_on_ready_table", "T6")) == 1


def test_stale_after_more_than_60s_keeps_party_and_records_once(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    feed.send()
    clock.advance(seconds=60)
    assert services.observations.sweep_stale() == 0
    assert services.board().tables[0].evidence.stale is False
    clock.advance(seconds=0.001)
    assert services.observations.sweep_stale() == 1
    assert services.observations.sweep_stale() == 0
    entry = services.board().tables[0]
    assert entry.evidence.stale is True
    assert entry.session.party_id is not None
    assert entry.session.operational_state is OperationalState.OCCUPIED
    # Recovery starts new continuity rather than resuming the old vacancy.
    feed.last = clock.now()
    feed.send(seconds=0)
    feed.send()
    feed.send()
    assert state(services) is OperationalState.OCCUPIED
    feed.send()
    assert state(services) is OperationalState.DEPARTURE_REVIEW


def test_replay_review_then_staff_confirmation_creates_exactly_one_task(services, clock, key):
    feed = Feed(services, clock)
    feed.send(seconds=0)
    for _ in range(3):
        feed.send()
    version = services.ctx.repo.get_session("T1").state_version
    entry = services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, version), ANA, key())
    assert entry.session.operational_state is OperationalState.NEEDS_CLEARING
    feed.send()  # more vacant evidence must not create more work
    tasks = [t for t in services.ctx.repo._data["tasks"].values() if t.table_id == "T1"]
    assert len(tasks) == 1
    task_id = tasks[0].task_id
    for action in (TaskAction.CLAIM, TaskAction.START):
        services.tasks.act(task_id, TaskActionRequest(action=action), ANA, key())
    version = services.ctx.repo.get_session("T1").state_version
    entry = services.tables.act("T1", table_req(TableAction.MARK_READY, version), ANA, key())
    assert entry.session.operational_state is OperationalState.READY
    assert entry.task.status is TaskStatus.COMPLETED


def test_unclear_does_not_extend_last_valid_observation(services, clock):
    feed = Feed(services, clock)
    feed.send(seconds=0, status=VisualStatus.OCCUPIED)
    valid_at = services.ctx.repo.get_session("T1").last_valid_observation_at
    feed.send(status=VisualStatus.UNCLEAR)
    assert services.ctx.repo.get_session("T1").last_valid_observation_at == valid_at


@pytest.fixture
def client(services, monkeypatch):
    monkeypatch.setenv("TURNWISE_GATEWAY_TOKEN", "local-secret")
    app.dependency_overrides[get_services] = lambda: services
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_http_ingestion_requires_gateway_token_not_actor_headers(client, services, clock):
    body = Feed(services, clock).make(seconds=0).model_dump(mode="json")
    human = {"X-Actor-Id": "manager-1", "X-Actor-Role": "manager"}
    assert client.post("/observations", json=body, headers=human).status_code == 401
    bad = {"Authorization": "Bearer nope"}
    assert client.post("/observations", json=body, headers=bad).status_code == 401
    ok = client.post("/observations", json=body, headers={"Authorization": "Bearer local-secret"})
    assert ok.status_code == 200
    assert ok.json()["evidence"]["camera_id"] == "cctv-01"
    board = client.get("/outlets/demo-outlet/board").json()
    assert board["tables"][0]["evidence"]["visual_status"] == "vacant"


def test_naive_timestamps_are_rejected(client, services, clock):
    body = Feed(services, clock).make(seconds=0).model_dump(mode="json")
    body["observed_at"] = body["observed_at"].replace("Z", "").split("+")[0]
    r = client.post("/observations", json=body, headers={"Authorization": "Bearer local-secret"})
    assert r.status_code == 422
