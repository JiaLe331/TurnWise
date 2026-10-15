import { useActions } from '@/lib/api/board'
import { ApiError } from '@/lib/api/client'
import { noteReleased } from '@/lib/api/seating'
import type { PartyAction, QueueParty, SeatingHold } from '@/lib/api/types'
import { can } from '@/lib/domain/permissions'
import { useIdentity } from '@/lib/identity/dev-identity'

export interface HoldTarget {
  table_id: string
  /** The table's state_version when the host chose it. */
  table_version: number
}

interface HoldOptions {
  reason?: string
  /** The API wants a host override reason; show the prompt instead of an error toast. */
  onOverride?: (message: string) => void
  onDone?: () => void
}

/** Waitlist and seating actions for hosts and managers, with the same feedback as table actions. */
export function useSeating() {
  const { run, pending, paused } = useActions()
  const { actor } = useIdentity()
  const canManage = can(actor?.role, 'create_hold')

  const hold = (party: QueueParty, target: HoldTarget, options: HoldOptions = {}) =>
    run(
      {
        kind: 'hold-create',
        tableId: target.table_id,
        request: {
          party_id: party.party_id,
          table_id: target.table_id,
          party_version: party.version,
          table_version: target.table_version,
          override_reason: options.reason?.trim() || null,
        },
      },
      {
        success: `${target.table_id} held for ${party.queue_code} for 60 s`,
        onSuccess: options.onDone,
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'override_reason_required' && options.onOverride) {
            options.onOverride(error.message)
            return true
          }
          return false
        },
      },
    )

  const confirm = (hold: SeatingHold, party: QueueParty | undefined) =>
    run(
      { kind: 'hold', tableId: hold.table_id, holdId: hold.hold_id, request: { action: 'confirm', expected_version: hold.version } },
      { success: `${party?.queue_code ?? 'Party'} seated at ${hold.table_id}` },
    )

  const release = (hold: SeatingHold) => {
    noteReleased(hold.hold_id)
    run(
      { kind: 'hold', tableId: hold.table_id, holdId: hold.hold_id, request: { action: 'cancel', expected_version: hold.version } },
      { success: `Hold on ${hold.table_id} released` },
    )
  }

  const addParty = (code: string, size: number, requirements: string[], onDone?: () => void) =>
    run(
      { kind: 'party-create', request: { queue_code: code.trim(), size, requirements } },
      { success: `${code.trim()} added to the waitlist`, onSuccess: onDone },
    )

  const updateParty = (
    party: QueueParty,
    action: PartyAction,
    extra: { size?: number; reason?: string } = {},
    onDone?: () => void,
  ) => {
    const success =
      action === 'update'
        ? `${party.queue_code} is now a party of ${extra.size ?? party.size}`
        : action === 'cancel'
          ? `${party.queue_code} removed from the waitlist`
          : `${party.queue_code} marked as left`
    run(
      {
        kind: 'party',
        partyId: party.party_id,
        queueCode: party.queue_code,
        request: {
          action,
          expected_version: party.version,
          size: extra.size ?? null,
          reason: extra.reason?.trim() || null,
        },
      },
      { success, onSuccess: onDone },
    )
  }

  return { hold, confirm, release, addParty, updateParty, pending, paused, canManage }
}
