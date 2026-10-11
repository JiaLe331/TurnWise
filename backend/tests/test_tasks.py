import threading

import pytest
from conftest import ANA, BEN, MANAGER, table_req, task_req

from turnwise.contracts import (
    Actor,
    OperationalState,
    TableAction,
    TaskAction,
    TaskStatus,
    UserRole,
)
from turnwise.domain.errors import BadRequest, Forbidden, InvalidTransition, VersionConflict


def _departed_task(services, key, table_id="T1"):
    version = services.ctx.repo.get_session(table_id).state_version
    entry = services.tables.act(
        table_id, table_req(TableAction.CONFIRM_DEPARTURE, version), ANA, key()
    )
    return entry.task.task_id


def test_repeated_departure_confirmation_does_not_duplicate_tasks(services, key):
    task_id = _departed_task(services, key)
    with pytest.raises(InvalidTransition):
        services.tables.act("T1", table_req(TableAction.CONFIRM_DEPARTURE, 2), ANA, key())

    session = services.ctx.repo.get_session("T1")
    assert services.tasks.create_for_session(session).task_id == task_id
    all_tasks = [t for t in services.board().tables if t.task and t.table.table_id == "T1"]
    assert len(all_tasks) == 1


def test_simultaneous_claims_produce_one_owner(services, key):
    task_id = _departed_task(services, key)
    results: list[str] = []
    errors: list[Exception] = []
    barrier = threading.Barrier(8)

    def claim(n: int) -> None:
        actor = Actor(actor_id=f"staff-{n}", role=UserRole.FLOOR_STAFF)
        barrier.wait()
        try:
            entry = services.tasks.act(task_id, task_req(TaskAction.CLAIM), actor, f"claim-{n}")
            results.append(entry.task.owner_id)
        except InvalidTransition as exc:
            errors.append(exc)

    threads = [threading.Thread(target=claim, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 1
    assert len(errors) == 7
    assert services.ctx.repo.get_task(task_id).owner_id == results[0]


def test_only_owner_or_manager_can_progress_a_task(services, key):
    task_id = _departed_task(services, key)
    services.tasks.act(task_id, task_req(TaskAction.CLAIM), ANA, key())

    with pytest.raises(Forbidden):
        services.tasks.act(task_id, task_req(TaskAction.START), BEN, key())
    entry = services.tasks.act(task_id, task_req(TaskAction.START), MANAGER, key())
    assert entry.task.status is TaskStatus.STARTED


def test_start_requires_claim_and_complete_requires_start(services, key):
    task_id = _departed_task(services, key)
    with pytest.raises(Forbidden):
        services.tasks.act(task_id, task_req(TaskAction.START), ANA, key())
    services.tasks.act(task_id, task_req(TaskAction.CLAIM), ANA, key())
    with pytest.raises(InvalidTransition):
        services.tasks.act(task_id, task_req(TaskAction.COMPLETE), ANA, key())


def test_release_returns_table_to_needs_clearing(services, key):
    task_id = _departed_task(services, key)
    services.tasks.act(task_id, task_req(TaskAction.CLAIM), ANA, key())
    services.tasks.act(task_id, task_req(TaskAction.START), ANA, key())

    entry = services.tasks.act(task_id, task_req(TaskAction.RELEASE), ANA, key())
    assert entry.task.status is TaskStatus.UNASSIGNED
    assert entry.task.owner_id is None
    assert entry.session.operational_state is OperationalState.NEEDS_CLEARING

    entry = services.tasks.act(task_id, task_req(TaskAction.CLAIM), BEN, key())
    assert entry.task.owner_id == BEN.actor_id


def test_cancel_is_manager_only_needs_reason_and_resets_cleaning(services, key):
    with pytest.raises(Forbidden):
        services.tasks.act("task_T5", task_req(TaskAction.CANCEL, reason="x"), ANA, key())
    with pytest.raises(BadRequest):
        services.tasks.act("task_T5", task_req(TaskAction.CANCEL), MANAGER, key())

    entry = services.tasks.act(
        "task_T5", task_req(TaskAction.CANCEL, reason="Spill"), MANAGER, key()
    )
    assert entry.task.status is TaskStatus.CANCELLED
    assert entry.session.operational_state is OperationalState.NEEDS_CLEARING


def test_stale_expected_version_on_task_action(services, key):
    task_id = _departed_task(services, key)
    with pytest.raises(VersionConflict):
        services.tasks.act(task_id, task_req(TaskAction.CLAIM, expected_version=1), ANA, key())


def test_clearing_queue_orders_oldest_departure_first(services, clock, key):
    clock.advance(minutes=1)
    _departed_task(services, key, "T1")
    queue = [e.table.table_id for e in services.board().clearing_queue]
    assert queue == ["T4", "T5", "T11", "T1"]
