import pytest
from conftest import ANA, MANAGER, SYSTEM, table_req, task_req

from turnwise.contracts import OperationalState, TableAction, TaskAction
from turnwise.domain.errors import InvalidTransition


def _types(services, table_id):
    return [e.event_type for e in services.ctx.repo.list_events(table_id) if e.source != "setup"]


def test_full_cycle_emits_expected_events_with_actor_and_time(services, clock, key):
    entry = services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, key())
    services.tasks.act(entry.task.task_id, task_req(TaskAction.CLAIM), ANA, key())
    services.tasks.act(entry.task.task_id, task_req(TaskAction.START), ANA, key())
    services.tables.act("T1", table_req(TableAction.MARK_READY, 3), ANA, key())

    events = services.ctx.repo.list_events("T1")[1:]  # skip state_initialized
    assert [e.event_type for e in events] == [
        "departure_confirmed",
        "party_left",
        "task_claimed",
        "cleaning_started",
        "ready_confirmed",
    ]
    for event in events:
        assert event.outlet_id == "demo-outlet"
        assert event.actor_id == ANA.actor_id
        assert event.source == "manual"
        assert event.event_time == clock.now()
        assert event.session_id == "sess_T1"


def test_system_actor_events_are_marked_as_observation_sourced(services, key):
    services.tables.act("T1", table_req(TableAction.REQUEST_DEPARTURE_REVIEW, 1), SYSTEM, key())
    event = services.ctx.repo.list_events("T1")[-1]
    assert event.event_type == "departure_review_requested"
    assert event.actor_type == "system"
    assert event.source == "observation"


def test_override_event_records_reason(services, key):
    request = table_req(
        TableAction.OVERRIDE_STATE, 1, target_state=OperationalState.READY, reason="Checked by eye"
    )
    services.tables.act("T1", request, MANAGER, key())
    event = services.ctx.repo.list_events("T1")[-1]
    assert event.event_type == "state_overridden"
    assert "occupied -> ready" in event.reason
    assert "Checked by eye" in event.reason


def test_failed_mutation_leaves_no_partial_state_or_events(services, key, monkeypatch):
    before = services.ctx.repo.list_events()

    def boom(*args, **kwargs):
        raise RuntimeError("storage failure")

    monkeypatch.setattr(services.ctx.repo, "append_event", boom)
    with pytest.raises(RuntimeError):
        services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, key())

    monkeypatch.undo()
    assert services.ctx.repo.list_events() == before
    session = services.ctx.repo.get_session("T1")
    assert session.operational_state is OperationalState.OCCUPIED
    assert session.state_version == 1
    assert services.ctx.repo.find_task("sess_T1") is None


def test_rejected_transition_adds_no_events(services, key):
    before = len(services.ctx.repo.list_events())
    with pytest.raises(InvalidTransition):
        services.tables.act("T6", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, key())
    assert len(services.ctx.repo.list_events()) == before
