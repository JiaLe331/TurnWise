from dataclasses import dataclass

from turnwise.contracts import Board
from turnwise.domain.board import build_board
from turnwise.domain.clock import Clock, SystemClock
from turnwise.domain.context import Context
from turnwise.domain.repository import InMemoryRepository
from turnwise.domain.seed import seed_demo_outlet
from turnwise.domain.tables import TableOperations
from turnwise.domain.tasks import TaskOperations

DEMO_OUTLET_ID = "demo-outlet"


@dataclass(frozen=True)
class Services:
    ctx: Context
    tables: TableOperations
    tasks: TaskOperations

    def board(self) -> Board:
        return build_board(self.ctx)


def build_services(clock: Clock | None = None, *, seed: bool = True) -> Services:
    ctx = Context(repo=InMemoryRepository(DEMO_OUTLET_ID), clock=clock or SystemClock())
    if seed:
        seed_demo_outlet(ctx)
    tasks = TaskOperations(ctx)
    return Services(ctx=ctx, tables=TableOperations(ctx, tasks), tasks=tasks)
