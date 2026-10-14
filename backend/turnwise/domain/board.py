import math
from datetime import UTC, datetime

from turnwise.contracts import Board, OperationalState, PartyStatus
from turnwise.domain.context import Context, entry_for
from turnwise.domain.repository import OPEN_TASK_STATUSES
from turnwise.domain.seating import active_queue, unsuitable

CLEARING_STATES = frozenset({OperationalState.NEEDS_CLEARING, OperationalState.CLEANING})
DEFAULT_PRIORITY = "Oldest confirmed departure first"


def build_board(ctx: Context) -> Board:
    entries = [entry_for(ctx, table.table_id) for table in ctx.repo.list_tables()]
    queue = active_queue(ctx)
    waiting = [p for p in queue if p.status is PartyStatus.WAITING]
    clearing = [
        e
        for e in entries
        if e.task is not None
        and e.task.status in OPEN_TASK_STATUSES
        and e.session.operational_state in CLEARING_STATES
    ]
    rank: dict[str, float] = {}
    for e in clearing:
        # FR05: work that can seat the oldest compatible waiting party goes first.
        serve = next(
            ((i, p) for i, p in enumerate(waiting) if unsuitable(e.table, p) is None), None
        )
        rank[e.table.table_id] = serve[0] if serve else math.inf
        if serve:
            p = serve[1]
            e.task.priority_reason = f"Can seat waiting party {p.queue_code} ({p.size})"
        else:
            e.task.priority_reason = DEFAULT_PRIORITY
    clearing.sort(
        key=lambda e: (
            rank[e.table.table_id],
            e.session.departed_at is None,
            e.session.departed_at or datetime.min.replace(tzinfo=UTC),
            e.table.table_id,
        ),
    )
    return Board(
        outlet_id=ctx.repo.outlet_id,
        generated_at=ctx.clock.now(),
        tables=entries,
        clearing_queue=clearing,
        waitlist=queue,
        holds=ctx.repo.list_active_holds(),
    )
