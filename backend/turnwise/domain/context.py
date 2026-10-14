from collections.abc import Callable
from dataclasses import dataclass
from uuid import uuid4

from turnwise.contracts import (
    Actor,
    ActorType,
    AuditEvent,
    OperationalState,
    TableBoardEntry,
    TableSession,
)
from turnwise.domain.clock import Clock
from turnwise.domain.errors import (
    BadRequest,
    IdempotencyConflict,
    NotFound,
    VersionConflict,
)
from turnwise.domain.evidence import evidence_for
from turnwise.domain.repository import OutletRepository


@dataclass(frozen=True)
class Context:
    repo: OutletRepository
    clock: Clock


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def check_version(session: TableSession, expected: int | None) -> None:
    if expected is not None and expected != session.state_version:
        raise VersionConflict(
            f"Table {session.table_id} is at version {session.state_version}, "
            f"not {expected}. Refresh and retry.",
        )


def require_reason(reason: str | None) -> str:
    if reason is None or not reason.strip():
        raise BadRequest("A reason is required for this action.", code="reason_required")
    return reason.strip()


def transition(session: TableSession, state: OperationalState) -> None:
    session.operational_state = state
    session.state_version += 1


def entry_for(ctx: Context, table_id: str) -> TableBoardEntry:
    table = ctx.repo.get_table(table_id)
    session = ctx.repo.get_session(table_id)
    if table is None or session is None:
        raise NotFound(f"Table {table_id} does not exist.")
    return TableBoardEntry(
        table=table,
        session=session,
        task=ctx.repo.find_task(session.session_id),
        evidence=evidence_for(ctx.repo.get_camera_state(table_id), session, ctx.clock.now()),
    )


def record_event(
    ctx: Context,
    *,
    event_type: str,
    actor: Actor,
    table_id: str | None = None,
    session_id: str | None = None,
    party_id: str | None = None,
    reason: str | None = None,
    source: str | None = None,
) -> AuditEvent:
    now = ctx.clock.now()
    event = AuditEvent(
        event_id=new_id("evt"),
        outlet_id=ctx.repo.outlet_id,
        table_id=table_id,
        party_id=party_id,
        session_id=session_id,
        event_type=event_type,
        event_time=now,
        received_at=now,
        actor_type=actor.actor_type.value,
        actor_id=actor.actor_id,
        source=source or ("observation" if actor.actor_type is ActorType.SYSTEM else "manual"),
        reason=reason,
    )
    ctx.repo.append_event(event)
    return event


def run_idempotent[T](ctx: Context, key: str, fingerprint: str, apply: Callable[[], T]) -> T:
    with ctx.repo.transaction():
        prior = ctx.repo.get_idempotent(key)
        if prior is not None:
            prior_fingerprint, result = prior
            if prior_fingerprint != fingerprint:
                raise IdempotencyConflict(
                    "This idempotency key was already used for a different request.",
                )
            return result
        result = apply()
        ctx.repo.put_idempotent(key, fingerprint, result)
        return result
