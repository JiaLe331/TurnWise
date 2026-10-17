import { UNCLAIMED_ALERT_S } from '@/config'
import type { TableBoardEntry } from '@/lib/api/types'
import { openTask } from './status'
import { secondsSince } from './time'

export type ExceptionKind = 'review' | 'unclaimed' | 'manual' | 'blocked'

export interface TableException {
  kind: ExceptionKind
  entry: TableBoardEntry
  label: string
}

/** Things a manager may want to look at, derived only from board data. */
export function findExceptions(entries: TableBoardEntry[], serverNow: number): TableException[] {
  const found: TableException[] = []
  for (const entry of entries) {
    const task = openTask(entry)
    if (entry.session.operational_state === 'departure_review') {
      found.push({ kind: 'review', entry, label: 'Departure check pending' })
    }
    if (task?.status === 'unassigned' && secondsSince(task.created_at, serverNow) >= UNCLAIMED_ALERT_S) {
      found.push({ kind: 'unclaimed', entry, label: `Unclaimed for ${UNCLAIMED_ALERT_S}+ s` })
    }
    if (entry.session.manual) found.push({ kind: 'manual', entry, label: 'Manual override active' })
    if (entry.table.blocked) found.push({ kind: 'blocked', entry, label: 'Blocked' })
  }
  return found
}
