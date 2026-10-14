"""Runs against the Firestore emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 uv run pytest."""

import os
from uuid import uuid4

import pytest
from conftest import ANA, HOST, table_req

from turnwise.camera_manifest import CameraManifest, TableRegion
from turnwise.contracts import (
    CreateHoldRequest,
    CreatePartyRequest,
    HoldAction,
    HoldActionRequest,
    OperationalState,
    PartyStatus,
    TableAction,
)
from turnwise.domain.services import build_services

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="Firestore emulator not running"
)


@pytest.fixture
def make(clock):
    from google.cloud import firestore

    from turnwise.domain.firestore_repository import FirestoreRepository

    client = firestore.Client(project="demo-turnwise")
    outlet = f"test-{uuid4().hex[:8]}"

    def build(manifests=None):
        repo = FirestoreRepository(outlet, client)
        repo.load()
        return build_services(clock, repo=repo, camera_manifests=manifests)

    return build


def test_seed_persists_and_reloads(make):
    first = make()
    again = make()
    assert [t.table_id for t in again.ctx.repo.list_tables()] == [
        t.table_id for t in first.ctx.repo.list_tables()
    ]
    assert len(again.ctx.repo.list_events()) == len(first.ctx.repo.list_events()) == 14
    assert again.board().clearing_queue[0].table.table_id == "T4"


def test_workflow_survives_restart_including_idempotency(make, key):
    services = make()
    services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, "dep-1")
    party = services.waitlist.create(CreatePartyRequest(queue_code="A1", size=4), HOST, key())
    held = services.seating.create_hold(
        CreateHoldRequest(party_id=party.party_id, table_id="T6", party_version=1, table_version=1),
        HOST,
        key(),
    )
    services.seating.act(
        held.hold.hold_id,
        HoldActionRequest(action=HoldAction.CONFIRM, expected_version=1),
        HOST,
        key(),
    )

    restarted = make()
    t1 = restarted.ctx.repo.get_session("T1")
    assert t1.operational_state is OperationalState.NEEDS_CLEARING
    assert restarted.ctx.repo.find_open_task(t1.session_id) is not None
    assert restarted.ctx.repo.get_party(party.party_id).status is PartyStatus.SEATED
    assert restarted.ctx.repo.get_session("T6").party_id == party.party_id
    events = [e.event_type for e in restarted.ctx.repo.list_events()]
    assert events[-1] == "party_seated" and "departure_confirmed" in events
    # A client retry after the restart replays the stored result instead of acting twice.
    replay = restarted.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, "dep-1")
    assert replay.session.operational_state is OperationalState.NEEDS_CLEARING
    assert events.count("departure_confirmed") == 1


def test_failed_write_rolls_back_memory(make, key, monkeypatch):
    services = make()
    repo = services.ctx.repo

    def broken(*_):
        raise ConnectionError("firestore down")

    monkeypatch.setattr(repo, "_flush", broken)
    with pytest.raises(ConnectionError):
        services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, key())
    assert repo.get_session("T1").operational_state is OperationalState.OCCUPIED
    monkeypatch.undo()
    assert make().ctx.repo.get_session("T1").operational_state is OperationalState.OCCUPIED


def test_manifest_changes_apply_to_persisted_tables(make):
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]

    def manifest(*tables):
        return CameraManifest(
            outlet_id=make().ctx.repo.outlet_id,
            camera_id="cctv-01",
            name="C",
            configuration_version=2,
            width=10,
            height=10,
            tables=[TableRegion(table_id=t, tabletop=square, seats=[square]) for t in tables],
        )

    make([manifest("T1", "T2")])
    reloaded = make([manifest("T1")])
    assert reloaded.ctx.repo.get_table("T1").camera_id == "cctv-01"
    assert reloaded.ctx.repo.get_table("T2").camera_id is None
    assert make().ctx.repo.get_table("T1").camera_id is None  # no manifests: all manual
