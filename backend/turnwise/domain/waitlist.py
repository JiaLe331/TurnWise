"""FR06: anonymous waitlist. Every change is audited; edits revalidate holds."""

from turnwise.contracts import (
    Actor,
    CreatePartyRequest,
    HoldStatus,
    PartyAction,
    PartyActionRequest,
    PartyStatus,
    QueueParty,
)
from turnwise.domain.context import Context, new_id, record_event, run_idempotent
from turnwise.domain.errors import InvalidTransition, NotFound, VersionConflict
from turnwise.domain.roles import require
from turnwise.domain.seating import ACTIVE_PARTY, SeatingOperations, fingerprint, unsuitable


class WaitlistOperations:
    def __init__(self, ctx: Context, seating: SeatingOperations) -> None:
        self.ctx = ctx
        self.seating = seating

    def create(self, req: CreatePartyRequest, actor: Actor, key: str) -> QueueParty:
        require(actor, "create_party")
        code = req.queue_code.strip().upper()

        def apply() -> QueueParty:
            if any(
                p.queue_code == code and p.status in ACTIVE_PARTY
                for p in self.ctx.repo.list_parties()
            ):
                raise InvalidTransition(f"Queue code {code} is in use.", code="queue_code_in_use")
            party = QueueParty(
                party_id=new_id("party"),
                queue_code=code,
                size=req.size,
                arrival_at=req.arrival_at or self.ctx.clock.now(),
                requirements=sorted({r.strip().lower() for r in req.requirements if r.strip()}),
                status=PartyStatus.WAITING,
            )
            self.ctx.repo.put_party(party)
            record_event(
                self.ctx,
                event_type="party_arrived",
                actor=actor,
                party_id=party.party_id,
                reason=f"{code}, party of {party.size}",
            )
            return party

        return run_idempotent(self.ctx, key, fingerprint("party:create", req), apply)

    def act(self, party_id: str, req: PartyActionRequest, actor: Actor, key: str) -> QueueParty:
        require(actor, f"{req.action.value}_party")
        self.seating.sweep()

        def apply() -> QueueParty:
            party = self.ctx.repo.get_party(party_id)
            if party is None:
                raise NotFound(f"Party {party_id} does not exist.")
            if party.version != req.expected_version:
                raise VersionConflict("Party changed. Refresh and retry.")
            if party.status not in ACTIVE_PARTY:
                raise InvalidTransition(f"Party is already {party.status.value}.")
            hold = next(
                (h for h in self.ctx.repo.list_active_holds() if h.party_id == party_id), None
            )
            if req.action is PartyAction.UPDATE:
                if req.size is not None:
                    party.size = req.size
                if req.requirements is not None:
                    party.requirements = sorted(
                        {r.strip().lower() for r in req.requirements if r.strip()}
                    )
                party.version += 1
                self.ctx.repo.put_party(party)
                record_event(
                    self.ctx,
                    event_type="party_updated",
                    actor=actor,
                    party_id=party_id,
                    reason=f"party of {party.size}, needs {party.requirements or 'nothing'}",
                )
                table = self.ctx.repo.get_table(hold.table_id) if hold else None
                problem = unsuitable(table, party) if table else None
                if hold and problem:
                    self.seating.release(
                        hold, HoldStatus.CANCELLED, actor, f"Party edited; table {problem}"
                    )
            else:
                if hold is not None:
                    self.seating.release(hold, HoldStatus.CANCELLED, actor, "Party left the queue")
                    party = self.ctx.repo.get_party(party_id)
                party.status = (
                    PartyStatus.CANCELLED if req.action is PartyAction.CANCEL else PartyStatus.LEFT
                )
                party.ended_at = self.ctx.clock.now()
                party.version += 1
                self.ctx.repo.put_party(party)
                record_event(
                    self.ctx,
                    event_type=f"party_{party.status.value}",
                    actor=actor,
                    party_id=party_id,
                    reason=req.reason,
                )
            return self.ctx.repo.get_party(party_id)

        return run_idempotent(self.ctx, key, fingerprint(f"party:{party_id}", req), apply)
