import threading
from datetime import timedelta

import pytest
from conftest import ANA, HOST, MANAGER, table_req
from fastapi.testclient import TestClient

from turnwise.api.deps import get_services
from turnwise.api.main import app
from turnwise.camera_manifest import CameraManifest, TableRegion
from turnwise.contracts import (
    Actor,
    CreateHoldRequest,
    CreatePartyRequest,
    HoldAction,
    HoldActionRequest,
    HoldStatus,
    ObservationSubmission,
    OperationalState,
    PartyAction,
    PartyActionRequest,
    PartyStatus,
    TableAction,
    UserRole,
    VisualStatus,
)
from turnwise.domain.errors import (
    Forbidden,
    IdempotencyConflict,
    InvalidTransition,
    VersionConflict,
)
from turnwise.domain.services import build_services

HOST2 = Actor(actor_id="host-2", role=UserRole.HOST)
# Seeded ready tables: T6 (4 seats, Main) and T9 (2 seats, Patio, outdoor).


def add(services, key, code, size, minutes_ago=0, requirements=(), actor=HOST):
    arrival = services.ctx.clock.now() - timedelta(minutes=minutes_ago)
    return services.waitlist.create(
        CreatePartyRequest(
            queue_code=code, size=size, arrival_at=arrival, requirements=list(requirements)
        ),
        actor,
        key(),
    )


def hold(services, key, party, table_id, reason=None, actor=HOST):
    party = services.ctx.repo.get_party(party.party_id)
    session = services.ctx.repo.get_session(table_id)
    return services.seating.create_hold(
        CreateHoldRequest(
            party_id=party.party_id,
            table_id=table_id,
            party_version=party.version,
            table_version=session.state_version,
            override_reason=reason,
        ),
        actor,
        key(),
    )


def hold_act(services, key, result, action, actor=HOST):
    return services.seating.act(
        result.hold.hold_id,
        HoldActionRequest(action=action, expected_version=result.hold.version),
        actor,
        key(),
    )


def party_act(services, key, party, action, **fields):
    party = services.ctx.repo.get_party(party.party_id)
    return services.waitlist.act(
        party.party_id,
        PartyActionRequest(action=action, expected_version=party.version, **fields),
        HOST,
        key(),
    )


def events(services, kind):
    return [e for e in services.ctx.repo.list_events() if e.event_type == kind]


def test_waitlist_is_ordered_by_arrival_and_audited(services, key):
    late = add(services, key, "b2", 2)
    early = add(services, key, "A1", 4, minutes_ago=5)
    assert late.queue_code == "B2"
    assert [p.queue_code for p in services.board().waitlist] == ["A1", "B2"]
    assert {e.party_id for e in events(services, "party_arrived")} == {
        late.party_id,
        early.party_id,
    }
    with pytest.raises(InvalidTransition):
        add(services, key, "A1", 2)
    with pytest.raises(Forbidden):
        add(services, key, "C3", 2, actor=ANA)


def test_recommends_smallest_suitable_table(services, key):
    add(services, key, "A1", 2)
    rec = services.seating.recommend()
    assert rec.party.queue_code == "A1"
    assert [t.table_id for t in rec.tables] == ["T9", "T6"]
    assert "seats 2" in rec.tables[0].reason


def test_oldest_party_with_an_eligible_table_and_visible_skips(services, key):
    add(services, key, "BIG", 8, minutes_ago=10)
    add(services, key, "PAIR", 2)
    rec = services.seating.recommend()
    assert rec.party.queue_code == "PAIR"
    assert [s.queue_code for s in rec.skipped] == ["BIG"]
    assert "party of 8" in rec.skipped[0].reason


def test_no_eligible_table_never_offers_occupied_or_dirty(services, key):
    add(services, key, "ACC", 4, requirements=["accessible"])  # T4 accessible but dirty
    rec = services.seating.recommend()
    assert rec.party is None and rec.tables == []
    assert rec.message == "No ready table fits a waiting party."


def test_hold_reserves_table_and_party_once(services, key):
    a = add(services, key, "A1", 2, minutes_ago=2)
    b = add(services, key, "B2", 2)
    result = hold(services, key, a, "T9")
    assert result.party.status is PartyStatus.ON_HOLD
    assert result.hold.expires_at == services.ctx.clock.now() + timedelta(seconds=60)
    with pytest.raises(InvalidTransition):
        hold(services, key, b, "T9", actor=HOST2)  # table already held
    with pytest.raises(InvalidTransition):
        hold(services, key, a, "T6")  # party already held
    rec = services.seating.recommend()
    assert rec.party.queue_code == "B2"
    assert [t.table_id for t in rec.tables] == ["T6"]


def test_stale_recommendation_is_a_version_conflict(services, key):
    a = add(services, key, "A1", 4)
    rec = services.seating.recommend()
    services.tables.act(
        "T6",
        table_req(TableAction.OVERRIDE_STATE, 1, target_state="occupied", reason="walk-in"),
        MANAGER,
        key(),
    )
    with pytest.raises(VersionConflict):
        services.seating.create_hold(
            CreateHoldRequest(
                party_id=a.party_id,
                table_id="T6",
                party_version=rec.party.version,
                table_version=rec.tables[0].table_version,
            ),
            HOST,
            key(),
        )


def test_confirm_starts_new_occupied_session(services, key):
    a = add(services, key, "A1", 4)
    old_session = services.ctx.repo.get_session("T6")
    result = hold_act(services, key, hold(services, key, a, "T6"), HoldAction.CONFIRM)
    session = result.table.session
    assert session.operational_state is OperationalState.OCCUPIED
    assert session.party_id == a.party_id
    assert session.session_id != old_session.session_id
    assert session.state_version == old_session.state_version + 1
    assert result.table.task is None
    assert result.party.status is PartyStatus.SEATED and result.party.table_id == "T6"
    assert result.hold.status is HoldStatus.CONFIRMED
    assert services.board().waitlist == []
    assert len(events(services, "party_seated")) == 1


def test_hold_expires_after_60s_and_party_keeps_queue_position(services, clock, key):
    a = add(services, key, "A1", 2, minutes_ago=5)
    add(services, key, "B2", 2)
    result = hold(services, key, a, "T9")
    clock.advance(seconds=60)
    assert services.seating.sweep() == 0
    clock.advance(seconds=0.001)
    assert services.seating.sweep() == 1
    with pytest.raises(InvalidTransition, match="expired"):
        hold_act(services, key, result, HoldAction.CONFIRM)
    assert [p.queue_code for p in services.board().waitlist] == ["A1", "B2"]
    assert services.ctx.repo.get_party(a.party_id).status is PartyStatus.WAITING
    assert len(events(services, "seating_hold_expired")) == 1


def test_queue_skip_needs_recorded_override_reason(services, key):
    add(services, key, "OLD", 4, minutes_ago=5)
    newer = add(services, key, "NEW", 2)
    with pytest.raises(InvalidTransition, match="skips waiting party OLD"):
        hold(services, key, newer, "T6")
    result = hold(services, key, newer, "T6", reason="OLD asked to wait for patio")
    assert "OLD asked to wait for patio" in result.hold.override_reason
    assert "skips waiting party OLD" in events(services, "seating_hold_created")[-1].reason


def test_missing_camera_evidence_needs_physical_check(mapped, key):
    a = add(mapped, key, "A1", 4)
    assert mapped.seating.recommend().tables == []
    with pytest.raises(InvalidTransition, match="no current camera evidence"):
        hold(mapped, key, a, "T6")
    result = hold(mapped, key, a, "T6", reason="Checked table in person")
    assert result.hold.manual
    hold_act(mapped, key, result, HoldAction.CONFIRM)
    assert events(mapped, "party_seated")[-1].reason.startswith("Manual assignment")


def _observe(services, clock, table_id, status, seq):
    now = clock.now()
    services.observations.ingest(
        ObservationSubmission(
            observation_id=f"o{seq}",
            frame_id=f"f{seq}",
            outlet_id="demo-outlet",
            camera_id="cctv-01",
            table_id=table_id,
            configuration_version=1,
            stream_id="run",
            gateway_sequence=seq,
            interval_started_at=now,
            observed_at=now,
            continuous_valid_coverage=True,
            occupied_seen=status is VisualStatus.OCCUPIED,
            unclear_seen=False,
            visual_status=status,
            occlusion=False,
            source_mode="replay",
            model_version="m",
            policy_version="p",
        ),
        None,
    )


@pytest.fixture
def mapped(clock):
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]
    manifest = CameraManifest(
        outlet_id="demo-outlet",
        camera_id="cctv-01",
        name="CCTV",
        configuration_version=1,
        width=10,
        height=10,
        tables=[TableRegion(table_id="T6", tabletop=square, seats=[square])],
    )
    return build_services(clock, camera_manifests=[manifest])


def test_fresh_vacant_camera_evidence_is_recommendable(mapped, clock, key):
    add(mapped, key, "A1", 4)
    _observe(mapped, clock, "T6", VisualStatus.VACANT, 1)
    rec = mapped.seating.recommend()
    assert [t.table_id for t in rec.tables] == ["T6"]
    assert rec.tables[0].evidence == "camera"


def test_guests_seen_at_held_table_invalidate_hold(mapped, clock, key):
    a = add(mapped, key, "A1", 4)
    _observe(mapped, clock, "T6", VisualStatus.VACANT, 1)
    result = hold(mapped, key, a, "T6")
    clock.advance(seconds=5)
    _observe(mapped, clock, "T6", VisualStatus.OCCUPIED, 2)
    assert mapped.seating.sweep() == 1
    assert mapped.ctx.repo.get_hold(result.hold.hold_id).status is HoldStatus.CANCELLED
    assert mapped.ctx.repo.get_party(a.party_id).status is PartyStatus.WAITING
    assert mapped.seating.recommend().tables == []


def test_state_correction_invalidates_hold(services, key):
    a = add(services, key, "A1", 4)
    result = hold(services, key, a, "T6")
    services.tables.act(
        "T6",
        table_req(TableAction.OVERRIDE_STATE, 1, target_state="occupied", reason="walk-in"),
        MANAGER,
        key(),
    )
    with pytest.raises(InvalidTransition, match="cancelled"):
        hold_act(services, key, result, HoldAction.CONFIRM)
    assert services.ctx.repo.get_session("T6").party_id is None


def test_cancelling_party_releases_hold(services, key):
    a = add(services, key, "A1", 4)
    hold(services, key, a, "T6")
    party = party_act(services, key, a, PartyAction.CANCEL, reason="left")
    assert party.status is PartyStatus.CANCELLED
    assert services.ctx.repo.list_active_holds() == []
    b = add(services, key, "B2", 4)
    assert [t.table_id for t in services.seating.recommend().tables] == ["T6"]
    assert services.seating.recommend().party.party_id == b.party_id


def test_editing_party_revalidates_hold(services, key):
    a = add(services, key, "A1", 2)
    hold(services, key, a, "T6")
    party_act(services, key, a, PartyAction.UPDATE, size=3)
    assert len(services.ctx.repo.list_active_holds()) == 1  # still fits 4 seats
    party = party_act(services, key, a, PartyAction.UPDATE, size=6)
    assert party.status is PartyStatus.WAITING
    assert services.ctx.repo.list_active_holds() == []


def test_departure_closes_seated_party(services, key):
    a = add(services, key, "A1", 4)
    seated = hold_act(services, key, hold(services, key, a, "T6"), HoldAction.CONFIRM)
    services.tables.act(
        "T6",
        table_req(TableAction.CONFIRM_DEPARTURE, seated.table.session.state_version),
        ANA,
        key(),
    )
    assert services.ctx.repo.get_party(a.party_id).status is PartyStatus.LEFT


def test_clearing_queue_prioritizes_task_that_serves_oldest_party(services, key):
    assert [e.table.table_id for e in services.board().clearing_queue] == ["T4", "T5", "T11"]
    add(services, key, "OUT", 4, requirements=["outdoor"])
    board = services.board()
    assert [e.table.table_id for e in board.clearing_queue] == ["T11", "T4", "T5"]
    assert board.clearing_queue[0].task.priority_reason == "Can seat waiting party OUT (4)"


def test_concurrent_hosts_cannot_double_assign(services, key):
    parties = [add(services, key, f"P{i}", 4, minutes_ago=10 - i) for i in range(4)]
    version = services.ctx.repo.get_session("T6").state_version
    outcomes: list[str] = []

    def attempt(i: int) -> None:
        try:
            services.seating.create_hold(
                CreateHoldRequest(
                    party_id=parties[i].party_id,
                    table_id="T6",
                    party_version=1,
                    table_version=version,
                    override_reason="race",
                ),
                Actor(actor_id=f"host-{i}", role=UserRole.HOST),
                f"race-{i}",
            )
            outcomes.append("ok")
        except InvalidTransition:
            outcomes.append("conflict")

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["conflict", "conflict", "conflict", "ok"]
    assert len(services.ctx.repo.list_active_holds()) == 1


def test_idempotent_hold_creation(services, key):
    a = add(services, key, "A1", 4)
    request = CreateHoldRequest(
        party_id=a.party_id, table_id="T6", party_version=1, table_version=1
    )
    first = services.seating.create_hold(request, HOST, "same")
    again = services.seating.create_hold(request, HOST, "same")
    assert first.hold.hold_id == again.hold.hold_id
    with pytest.raises(IdempotencyConflict):
        services.seating.create_hold(request.model_copy(update={"table_id": "T9"}), HOST, "same")


@pytest.fixture
def client(services):
    app.dependency_overrides[get_services] = lambda: services
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_http_seating_flow(client):
    host = {"X-Actor-Id": "host-1", "X-Actor-Role": "host"}
    staff = {"X-Actor-Id": "staff-ana", "X-Actor-Role": "floor_staff"}
    body = {"queue_code": "A7", "size": 2}
    assert (
        client.post("/parties", json=body, headers={**staff, "Idempotency-Key": "s"}).status_code
        == 403
    )
    party = client.post("/parties", json=body, headers={**host, "Idempotency-Key": "p"}).json()
    rec = client.get("/recommendations").json()
    assert rec["party"]["queue_code"] == "A7"
    option = rec["tables"][0]
    held = client.post(
        "/seating-holds",
        json={
            "party_id": party["party_id"],
            "table_id": option["table_id"],
            "party_version": rec["party"]["version"],
            "table_version": option["table_version"],
        },
        headers={**host, "Idempotency-Key": "h"},
    )
    assert held.status_code == 200
    hold = held.json()["hold"]
    board = client.get("/outlets/demo-outlet/board").json()
    assert board["holds"][0]["hold_id"] == hold["hold_id"]
    seated = client.post(
        f"/seating-holds/{hold['hold_id']}/actions",
        json={"action": "confirm", "expected_version": hold["version"]},
        headers={**host, "Idempotency-Key": "c"},
    )
    assert seated.status_code == 200
    assert seated.json()["table"]["session"]["operational_state"] == "occupied"
    assert client.get("/parties").json() == []
    conflict = client.post(
        "/seating-holds",
        json={
            "party_id": party["party_id"],
            "table_id": option["table_id"],
            "party_version": 1,
            "table_version": option["table_version"],
        },
        headers={**host, "Idempotency-Key": "h2"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "party_not_waiting"
