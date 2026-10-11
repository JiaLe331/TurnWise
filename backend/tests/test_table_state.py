import pytest
from conftest import ANA, BEN, HOST, MANAGER, MODEL, SYSTEM, table_req, task_req

from turnwise.contracts import OperationalState, TableAction, TaskAction, TaskStatus
from turnwise.domain.errors import (
    BadRequest,
    Forbidden,
    InvalidTransition,
    VersionConflict,
)


def test_full_manual_cycle(services, clock, key):
    entry = services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), ANA, key())
    assert entry.session.operational_state is OperationalState.NEEDS_CLEARING
    assert entry.session.party_id is None
    assert entry.session.state_version == 2
    assert entry.task is not None
    assert entry.task.status is TaskStatus.UNASSIGNED
    task_id = entry.task.task_id

    entry = services.tasks.act(task_id, task_req(TaskAction.CLAIM), ANA, key())
    assert entry.task.owner_id == ANA.actor_id

    clock.advance(minutes=4)
    entry = services.tasks.act(task_id, task_req(TaskAction.START), ANA, key())
    assert entry.session.operational_state is OperationalState.CLEANING

    clock.advance(minutes=3)
    entry = services.tables.act("T1", table_req(TableAction.MARK_READY, 3), ANA, key())
    assert entry.session.operational_state is OperationalState.READY
    assert entry.session.ready_at == clock.now()
    assert entry.task.status is TaskStatus.COMPLETED
    assert entry.session.state_version == 4


def test_departure_review_can_be_dismissed_without_creating_work(services, key):
    entry = services.tables.act(
        "T1", table_req(TableAction.REQUEST_DEPARTURE_REVIEW, 1), SYSTEM, key()
    )
    assert entry.session.operational_state is OperationalState.DEPARTURE_REVIEW

    entry = services.tables.act("T1", table_req(TableAction.DISMISS_REVIEW, 2), ANA, key())
    assert entry.session.operational_state is OperationalState.OCCUPIED
    assert entry.session.party_id is not None
    assert entry.task is None


def test_model_and_system_cannot_mark_ready_or_confirm_departure(services, key):
    for actor in (MODEL, SYSTEM):
        with pytest.raises(Forbidden):
            services.tables.act("T5", table_req(TableAction.MARK_READY, 1), actor, key())
        with pytest.raises(Forbidden):
            services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 1), actor, key())
    assert services.board().tables[4].session.operational_state is OperationalState.CLEANING


def test_model_cannot_request_departure_review(services, key):
    with pytest.raises(Forbidden):
        services.tables.act("T1", table_req(TableAction.REQUEST_DEPARTURE_REVIEW, 1), MODEL, key())


@pytest.mark.parametrize(
    ("table_id", "action"),
    [
        ("T1", TableAction.MARK_READY),
        ("T1", TableAction.DISMISS_REVIEW),
        ("T6", TableAction.CONFIRM_DEPARTURE),
        ("T4", TableAction.REQUEST_DEPARTURE_REVIEW),
        ("T4", TableAction.MARK_READY),
    ],
)
def test_illegal_transitions_are_rejected(services, key, table_id, action):
    version = services.ctx.repo.get_session(table_id).state_version
    with pytest.raises(InvalidTransition):
        services.tables.act(table_id, table_req(action, version), ANA, key())


def test_stale_version_is_rejected_and_changes_nothing(services, key):
    events_before = len(services.ctx.repo.list_events())
    with pytest.raises(VersionConflict):
        services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 99), ANA, key())
    assert services.ctx.repo.get_session("T1").operational_state is OperationalState.OCCUPIED
    assert len(services.ctx.repo.list_events()) == events_before


def test_expected_version_is_required_for_state_changes(services, key):
    with pytest.raises(BadRequest):
        services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE), ANA, key())


def test_override_requires_manager_reason_and_marks_manual(services, key):
    request = table_req(
        TableAction.OVERRIDE_STATE,
        1,
        target_state=OperationalState.OCCUPIED,
        reason="Guests returned",
    )
    for actor in (HOST, ANA):
        with pytest.raises(Forbidden):
            services.tables.act("T6", request, actor, key())

    with pytest.raises(BadRequest):
        no_reason = table_req(TableAction.OVERRIDE_STATE, 1, target_state=OperationalState.OCCUPIED)
        services.tables.act("T6", no_reason, MANAGER, key())

    entry = services.tables.act("T6", request, MANAGER, key())
    assert entry.session.operational_state is OperationalState.OCCUPIED
    assert entry.session.manual is True

    entry = services.tables.act("T6", table_req(TableAction.RELEASE_OVERRIDE, 2), BEN, key())
    assert entry.session.manual is False


def test_override_to_needs_clearing_creates_one_task_and_to_occupied_cancels_it(services, key):
    to_clear = table_req(
        TableAction.OVERRIDE_STATE, 1, target_state=OperationalState.NEEDS_CLEARING, reason="Missed"
    )
    entry = services.tables.act("T1", to_clear, MANAGER, key())
    assert entry.task is not None
    assert entry.task.status is TaskStatus.UNASSIGNED

    back = table_req(
        TableAction.OVERRIDE_STATE, 2, target_state=OperationalState.OCCUPIED, reason="Wrong table"
    )
    entry = services.tables.act("T1", back, MANAGER, key())
    assert entry.task.status is TaskStatus.CANCELLED
    assert services.ctx.repo.find_open_task(entry.session.session_id) is None


def test_override_cannot_target_cleaning(services, key):
    request = table_req(
        TableAction.OVERRIDE_STATE, 1, target_state=OperationalState.CLEANING, reason="x"
    )
    with pytest.raises(InvalidTransition):
        services.tables.act("T1", request, MANAGER, key())


def test_block_and_unblock_are_manager_only(services, key):
    with pytest.raises(Forbidden):
        services.tables.act("T6", table_req(TableAction.BLOCK, reason="Broken"), ANA, key())
    entry = services.tables.act("T6", table_req(TableAction.BLOCK, reason="Broken"), MANAGER, key())
    assert entry.table.blocked is True
    entry = services.tables.act("T6", table_req(TableAction.UNBLOCK), MANAGER, key())
    assert entry.table.blocked is False
