import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { compareTableIds } from '@/lib/domain/status'
import { useBoard } from './board'
import { apiScopeKey, request } from './client'
import type { Board, QueueParty, Recommendation, SeatingHold, TableBoardEntry } from './types'

/**
 * Seating suggestions for the oldest seatable party, or for one party. Re-asked whenever the board
 * changes, because a newly ready table or a new arrival changes the answer.
 */
export function useRecommendation(partyId: string | null = null, enabled = true) {
  const { board } = useBoard()
  return useQuery({
    queryKey: ['recommendation', apiScopeKey(), partyId, board?.generated_at],
    queryFn: () =>
      request<Recommendation>(partyId ? `/recommendations?party_id=${encodeURIComponent(partyId)}` : '/recommendations'),
    enabled: enabled && Boolean(board),
    placeholderData: (previous) => previous,
    retry: false,
  })
}

export function waitlistOf(board: Board | undefined): QueueParty[] {
  return board?.waitlist ?? []
}

export function holdsByTable(board: Board | undefined): Map<string, SeatingHold> {
  return new Map((board?.holds ?? []).filter((h) => h.status === 'active').map((h) => [h.table_id, h]))
}

export function holdsByParty(board: Board | undefined): Map<string, SeatingHold> {
  return new Map((board?.holds ?? []).filter((h) => h.status === 'active').map((h) => [h.party_id, h]))
}

/** Whole seconds until a hold expires, measured on the server clock. */
export function secondsLeft(hold: SeatingHold, serverNow: number): number {
  return Math.max(0, Math.ceil((Date.parse(hold.expires_at) - serverNow) / 1000))
}

/** The next free walk-in code: W1, W2, … above the highest W-code still on the waitlist. */
export function nextQueueCode(waitlist: QueueParty[]): string {
  const used = waitlist.map((p) => /^W(\d+)$/i.exec(p.queue_code)?.[1]).filter(Boolean).map(Number)
  return `W${used.length ? Math.max(...used) + 1 : 1}`
}

/** Requirements a party can ask for: the attributes some table on this floor actually has. */
export function seatingAttributes(entries: TableBoardEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => e.table.attributes))].sort()
}

/**
 * Why a table can never take this party right now, or null when it fits. Mirrors `unsuitable()` in
 * backend/turnwise/domain/seating.py for filtering the UI only; the API still decides.
 */
export function unsuitable(party: QueueParty, entry: TableBoardEntry): string | null {
  if (entry.table.blocked) return 'blocked'
  if (entry.table.capacity < party.size) return `seats ${entry.table.capacity}, party of ${party.size}`
  const missing = party.requirements.filter((r) => !entry.table.attributes.includes(r))
  return missing.length ? `not ${missing.join(', ')}` : null
}

export function readyTablesFor(party: QueueParty, entries: TableBoardEntry[], held: Map<string, SeatingHold>) {
  return entries
    .filter((e) => e.session.operational_state === 'ready' && !held.has(e.table.table_id) && !unsuitable(party, e))
    .sort((a, b) => a.table.capacity - b.table.capacity || compareTableIds(a.table.table_id, b.table.table_id))
}

/** Holds this device released on purpose, so their disappearance isn't reported as an expiry. */
const released = new Set<string>()
export function noteReleased(holdId: string) {
  released.add(holdId)
}

/** Says so when a hold runs out: the party keeps its place in the queue (PRD FR08). */
export function useHoldExpiryNotice() {
  const { board } = useBoard()
  const previous = useRef<Map<string, SeatingHold> | null>(null)
  useEffect(() => {
    if (!board) return
    const now = new Map((board.holds ?? []).filter((h) => h.status === 'active').map((h) => [h.hold_id, h]))
    const before = previous.current
    previous.current = now
    if (!before) return
    for (const [id, hold] of before) {
      if (now.has(id) || released.has(id)) continue
      const party = (board.waitlist ?? []).find((p) => p.party_id === hold.party_id)
      if (party?.status === 'waiting') {
        toast(`Hold on ${hold.table_id} expired; ${party.queue_code} keeps their place`)
      }
    }
  }, [board])
}
