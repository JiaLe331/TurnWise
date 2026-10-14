from collections.abc import Sequence
from datetime import datetime, timedelta

from turnwise.camera_manifest import CameraManifest
from turnwise.contracts import (
    Actor,
    ActorType,
    ClearingTask,
    OperationalState,
    Table,
    TableSession,
    TaskStatus,
)
from turnwise.domain.context import Context, record_event

SEED_ACTOR = Actor(actor_id="setup", actor_type=ActorType.SYSTEM)

# table_id, capacity, zone, attributes, state, minutes since the state began
LAYOUT: list[tuple[str, int, str, list[str], OperationalState, int]] = [
    ("T1", 2, "Main", [], OperationalState.OCCUPIED, 35),
    ("T2", 2, "Main", [], OperationalState.OCCUPIED, 20),
    ("T3", 2, "Main", [], OperationalState.DEPARTURE_REVIEW, 1),
    ("T4", 4, "Main", ["accessible"], OperationalState.NEEDS_CLEARING, 6),
    ("T5", 4, "Main", [], OperationalState.CLEANING, 4),
    ("T6", 4, "Main", [], OperationalState.READY, 3),
    ("T7", 4, "Main", [], OperationalState.OCCUPIED, 50),
    ("T8", 6, "Main", [], OperationalState.OCCUPIED, 12),
    ("T9", 2, "Patio", ["outdoor"], OperationalState.READY, 8),
    ("T10", 4, "Patio", ["outdoor"], OperationalState.OCCUPIED, 28),
    ("T11", 4, "Patio", ["outdoor"], OperationalState.NEEDS_CLEARING, 2),
    ("T12", 8, "Patio", ["outdoor"], OperationalState.OCCUPIED, 41),
]


def seed_demo_outlet(ctx: Context, manifests: Sequence[CameraManifest] = ()) -> None:
    now = ctx.clock.now()
    with ctx.repo.transaction():
        _seed_layout(ctx, now)
        for manifest in manifests:
            apply_manifest(ctx, manifest)


def apply_manifest(ctx: Context, manifest: CameraManifest) -> None:
    if manifest.outlet_id != ctx.repo.outlet_id:
        return
    for region in manifest.tables:
        table = ctx.repo.get_table(region.table_id)
        if table is None:
            raise ValueError(f"{manifest.camera_id} maps unknown table {region.table_id}")
        if table.camera_id not in (None, manifest.camera_id):
            raise ValueError(f"{region.table_id} is already mapped to {table.camera_id}")
        table.camera_id = manifest.camera_id
        table.region = region.model_dump()
        table.configuration_version = manifest.configuration_version
        ctx.repo.put_table(table)


def _seed_layout(ctx: Context, now: datetime) -> None:
    for table_id, capacity, zone, attributes, state, minutes in LAYOUT:
        began = now - timedelta(minutes=minutes)
        ctx.repo.put_table(
            Table(
                outlet_id=ctx.repo.outlet_id,
                table_id=table_id,
                capacity=capacity,
                zone=zone,
                attributes=attributes,
                camera_id=None,
                region=None,
                configuration_version=1,
                blocked=False,
            ),
        )
        session = TableSession(
            session_id=f"sess_{table_id}",
            table_id=table_id,
            party_id=f"seed-party-{table_id}" if state is OperationalState.OCCUPIED else None,
            operational_state=state,
            state_version=1,
            last_valid_observation_at=None,
            seated_at=began if state is OperationalState.OCCUPIED else None,
            departed_at=None if state is OperationalState.OCCUPIED else began,
            ready_at=began if state is OperationalState.READY else None,
        )
        ctx.repo.put_session(session)
        _seed_task(ctx, session)
        record_event(
            ctx,
            event_type="state_initialized",
            actor=SEED_ACTOR,
            table_id=table_id,
            session_id=session.session_id,
            reason=f"Initial setup: {state.value}",
        )


def _seed_task(ctx: Context, session: TableSession) -> None:
    if session.operational_state not in (
        OperationalState.NEEDS_CLEARING,
        OperationalState.CLEANING,
    ):
        return
    cleaning = session.operational_state is OperationalState.CLEANING
    assert session.departed_at is not None
    ctx.repo.put_task(
        ClearingTask(
            task_id=f"task_{session.table_id}",
            session_id=session.session_id,
            table_id=session.table_id,
            status=TaskStatus.STARTED if cleaning else TaskStatus.UNASSIGNED,
            priority_reason="Oldest confirmed departure first",
            owner_id="staff-ana" if cleaning else None,
            created_at=session.departed_at,
            started_at=session.departed_at if cleaning else None,
            completed_at=None,
        ),
    )
