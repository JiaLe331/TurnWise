from dataclasses import dataclass

from turnwise.camera_manifest import CameraManifest
from turnwise.contracts import Board
from turnwise.domain.board import build_board
from turnwise.domain.briefing import BriefingService
from turnwise.domain.clock import Clock, SystemClock
from turnwise.domain.context import Context
from turnwise.domain.observations import ObservationOperations
from turnwise.domain.repository import InMemoryRepository, OutletRepository
from turnwise.domain.seating import SeatingOperations
from turnwise.domain.seed import seed_demo_outlet, sync_manifests
from turnwise.domain.tables import TableOperations
from turnwise.domain.tasks import TaskOperations
from turnwise.domain.waitlist import WaitlistOperations

DEMO_OUTLET_ID = "demo-outlet"


@dataclass(frozen=True)
class Services:
    ctx: Context
    tables: TableOperations
    tasks: TaskOperations
    observations: ObservationOperations
    seating: SeatingOperations
    waitlist: WaitlistOperations
    briefing: BriefingService

    def board(self) -> Board:
        return build_board(self.ctx)

    def sweep(self) -> None:
        """Time-driven rules: stale cameras and expired or invalidated holds."""
        self.observations.sweep_stale()
        self.seating.sweep()


def build_services(
    clock: Clock | None = None,
    *,
    seed: bool = True,
    camera_manifests: list[CameraManifest] | None = None,
    repo: OutletRepository | None = None,
) -> Services:
    """`repo` defaults to a fresh in-memory outlet; a loaded persistent repo is not reseeded."""
    ctx = Context(repo=repo or InMemoryRepository(DEMO_OUTLET_ID), clock=clock or SystemClock())
    if seed and not ctx.repo.list_tables():
        seed_demo_outlet(ctx)
    sync_manifests(ctx, camera_manifests or [])
    tasks = TaskOperations(ctx)
    seating = SeatingOperations(ctx)
    return Services(
        ctx=ctx,
        tables=TableOperations(ctx, tasks),
        tasks=tasks,
        observations=ObservationOperations(ctx),
        seating=seating,
        waitlist=WaitlistOperations(ctx, seating),
        briefing=BriefingService(ctx),
    )
