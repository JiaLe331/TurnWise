import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { findExceptions } from '@/lib/domain/exceptions'

export type Lens = 'status' | 'clearing' | 'cameras' | 'exceptions'

/** Which tables a lens is about. Others are dimmed in the scene. */
export function inLens(lens: Lens, entry: TableBoardEntry, queued: Set<string>, flagged: Set<string>): boolean {
  if (lens === 'clearing') return queued.has(entry.table.table_id) || entry.session.operational_state === 'departure_review'
  if (lens === 'exceptions') return flagged.has(entry.table.table_id)
  return true
}

export function useLensSets() {
  const { board, entries, serverNow } = useBoard()
  const queued = new Set((board?.clearing_queue ?? []).map((e) => e.table.table_id))
  const flagged = new Set(findExceptions(entries, serverNow).map((x) => x.entry.table.table_id))
  return { queued, flagged }
}
