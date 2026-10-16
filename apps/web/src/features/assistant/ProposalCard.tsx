import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { describeError, useActions, useBoard, type ActionInput } from '@/lib/api/board'
import { waitlistOf } from '@/lib/api/seating'
import type { Board, PartyAction, SeatingResult, TableAction, TaskAction } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import type { Proposal, ProposalOutcome } from './types'

const TABLE_ACTIONS = ['confirm_departure', 'mark_ready', 'dismiss_review', 'block', 'unblock']
const TASK_ACTIONS = ['claim', 'start', 'complete']
const PARTY_ACTIONS = ['cancel', 'left']

type Mapped = { input: ActionInput; subject: string; seatPartyCode?: string } | { error: string }

/** Turns the assistant's proposal into the same action input the buttons use, against the current board. */
function toAction(p: Proposal, board: Board | undefined): Mapped {
  const stale = { error: 'This no longer matches the floor.' }
  const entry = board?.tables.find((e) => e.table.table_id === p.table_id)
  const party = waitlistOf(board).find((x) => x.party_id === p.party_id)
  if (p.kind === 'table' && entry && TABLE_ACTIONS.includes(p.action)) {
    return { input: { kind: 'table', tableId: entry.table.table_id, request: { action: p.action as TableAction, reason: p.reason } }, subject: entry.table.table_id }
  }
  if (p.kind === 'task' && entry?.task && TASK_ACTIONS.includes(p.action)) {
    return {
      input: { kind: 'task', tableId: entry.table.table_id, taskId: entry.task.task_id, request: { action: p.action as TaskAction, reason: p.reason } },
      subject: entry.table.table_id,
    }
  }
  if (p.kind === 'party' && party && PARTY_ACTIONS.includes(p.action)) {
    return {
      input: { kind: 'party', partyId: party.party_id, queueCode: party.queue_code, request: { action: p.action as PartyAction, expected_version: party.version, reason: p.reason } },
      subject: party.queue_code,
    }
  }
  if (p.kind === 'seat' && entry && party) {
    return {
      input: {
        kind: 'hold-create',
        tableId: entry.table.table_id,
        request: { party_id: party.party_id, table_id: entry.table.table_id, party_version: party.version, table_version: entry.session.state_version },
      },
      subject: entry.table.table_id,
      seatPartyCode: party.queue_code,
    }
  }
  return stale
}

/** An action the assistant proposes. Nothing changes until the manager confirms; the outcome goes back to the chat. */
export function ProposalCard({
  proposal,
  outcome,
  onOutcome,
}: {
  proposal: Proposal
  outcome: ProposalOutcome | undefined
  onOutcome: (outcome: ProposalOutcome) => void
}) {
  const { board } = useBoard()
  const { run, paused } = useActions()
  const [working, setWorking] = useState(false)

  function confirm() {
    const mapped = toAction(proposal, board)
    if ('error' in mapped) return onOutcome({ status: 'failed', detail: mapped.error })
    setWorking(true)
    const fail = (error: unknown) => {
      setWorking(false)
      onOutcome({ status: 'failed', detail: describeError(error, mapped.subject) })
      return false
    }
    run(mapped.input, {
      success: proposal.title,
      onError: fail,
      onSuccess: (result) => {
        if (!mapped.seatPartyCode) {
          setWorking(false)
          return onOutcome({ status: 'done', detail: proposal.title })
        }
        // Seating is a hold, then its confirmation, as at the host stand.
        const { hold } = result as SeatingResult
        run(
          { kind: 'hold', tableId: hold.table_id, holdId: hold.hold_id, request: { action: 'confirm', expected_version: hold.version } },
          {
            success: `${mapped.seatPartyCode} seated at ${hold.table_id}`,
            onError: fail,
            onSuccess: () => {
              setWorking(false)
              onOutcome({ status: 'done', detail: `${mapped.seatPartyCode} seated at ${hold.table_id}` })
            },
          },
        )
      },
    })
  }

  return (
    <div className={cn('mb-2 rounded-xl border px-3 py-2.5', outcome ? 'border-rule bg-wash' : 'border-[#e9d3a8] bg-review-tint')}>
      <div className={cn('mb-0.5 text-[11px] font-bold tracking-[0.06em] uppercase', outcome ? 'text-pewter' : 'text-review-deep')}>
        {outcome ? { done: 'Done', declined: 'Not now', failed: "Couldn't do it" }[outcome.status] : 'Proposed action'}
      </div>
      <div className="font-semibold">{proposal.title}</div>
      {outcome ? (
        outcome.status === 'failed' ? <div className="text-[12.5px] text-clearing-deep">{outcome.detail}</div> : null
      ) : (
        <>
          <div className="mb-2 text-[12.5px] text-review-deep">{proposal.reason}</div>
          <div className="flex gap-1.5">
            <Button size="sm" tone="primary" pending={working} disabled={paused} onClick={confirm}>
              Confirm
            </Button>
            <Button size="sm" tone="secondary" disabled={working} onClick={() => onOutcome({ status: 'declined', detail: 'The manager chose not to.' })}>
              Not now
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
