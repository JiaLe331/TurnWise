import type { Recommendation, TableBoardEntry } from '@/lib/api/types'

export type DemoRole = 'host' | 'staff' | 'manager'

export interface Hint {
  id: string
  role: DemoRole
  tableId: string | null
  title: string
  detail: string
  source: 'camera' | 'gemini' | 'rules'
  /** Worth pausing the replay for. */
  pause: boolean
}

/**
 * The demo's "AI guide": deterministic next steps from the board, camera evidence and Gemini's
 * table checks, most urgent first. Suggestions only; the viewer performs every action.
 */
export function hints(entries: TableBoardEntry[], rec: Recommendation | undefined): Hint[] {
  const out: Hint[] = []
  for (const e of entries) {
    const id = e.table.table_id
    const s = e.session.operational_state
    if (s === 'departure_review') {
      out.push({
        id: `review-${id}`,
        role: 'staff',
        tableId: id,
        title: `${id} looks empty: confirm the departure`,
        detail:
          e.evidence?.review_source === 'observation'
            ? 'The camera has seen no seated guests for 30 s. Check the table, then confirm or keep the party.'
            : 'A departure check is pending.',
        source: 'camera',
        pause: true,
      })
    }
  }
  for (const e of entries) {
    const id = e.table.table_id
    const s = e.session.operational_state
    const task = e.task
    if (s === 'needs_clearing' && task && !task.owner_id) {
      out.push({ id: `claim-${id}`, role: 'staff', tableId: id, title: `Claim clearing for ${id}`, detail: task.priority_reason, source: 'rules', pause: false })
    } else if (s === 'needs_clearing' && task?.status === 'claimed') {
      out.push({ id: `start-${id}`, role: 'staff', tableId: id, title: `Start clearing ${id}`, detail: `${task.owner_id} has claimed it.`, source: 'rules', pause: false })
    } else if (s === 'cleaning') {
      const items = e.evidence?.table_check
      const leftovers = items?.state === 'leftovers' ? ` Gemini still sees ${items.items.join(', ') || 'items'}.` : ''
      out.push({ id: `ready-${id}`, role: 'staff', tableId: id, title: `Finish ${id} and mark it Ready`, detail: `Reset the table, then confirm Ready.${leftovers}`, source: leftovers ? 'gemini' : 'rules', pause: false })
    }
  }
  for (const e of entries) {
    const id = e.table.table_id
    const check = e.evidence?.table_check
    if (e.session.operational_state !== 'ready') continue
    if (e.evidence?.visual_status === 'occupied' && !e.evidence.stale) {
      out.push({
        id: `guests-${id}`,
        role: 'host',
        tableId: id,
        title: `Camera sees guests at ${id}, which is still marked ready`,
        detail: 'Seat the waiting party there to start their session, or walk over and verify.',
        source: 'camera',
        // Shown, but never worth stopping the replay: staff passing a table look the same on camera.
        pause: false,
      })
    } else if (check?.state === 'leftovers' && !check.people_present) {
      out.push({
        id: `left-${id}-${check.checked_at}`,
        role: 'staff',
        tableId: id,
        title: `Gemini sees ${check.items.join(', ') || 'items'} on ready table ${id}`,
        detail: `${check.reason} Check the table before the host seats anyone.`,
        source: 'gemini',
        pause: true,
      })
    }
  }
  if (rec?.party && rec.tables[0]) {
    out.push({
      id: `seat-${rec.party.party_id}`,
      role: 'host',
      tableId: rec.tables[0].table_id,
      title: `Seat ${rec.party.queue_code} (party of ${rec.party.size}) at ${rec.tables[0].table_id}`,
      detail: rec.tables[0].reason,
      source: 'rules',
      pause: false,
    })
  }
  return out
}
