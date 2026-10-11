from datetime import UTC, datetime

from turnwise.contracts import Board, OperationalState
from turnwise.domain.context import Context, entry_for
from turnwise.domain.repository import OPEN_TASK_STATUSES

CLEARING_STATES = frozenset({OperationalState.NEEDS_CLEARING, OperationalState.CLEANING})


def build_board(ctx: Context) -> Board:
    entries = [entry_for(ctx, table.table_id) for table in ctx.repo.list_tables()]
    queue = [
        e
        for e in entries
        if e.task is not None
        and e.task.status in OPEN_TASK_STATUSES
        and e.session.operational_state in CLEARING_STATES
    ]
    queue.sort(
        key=lambda e: (
            e.session.departed_at is None,
            e.session.departed_at or datetime.min.replace(tzinfo=UTC),
            e.table.table_id,
        ),
    )
    return Board(
        outlet_id=ctx.repo.outlet_id,
        generated_at=ctx.clock.now(),
        tables=entries,
        clearing_queue=queue,
    )
