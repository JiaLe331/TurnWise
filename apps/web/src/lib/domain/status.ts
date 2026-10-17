import {
  CircleCheck,
  DoorOpen,
  SprayCan,
  Users,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import type { OperationalState, TableBoardEntry, TaskStatus } from '@/lib/api/types'

export interface StateStyle {
  label: string
  icon: LucideIcon
  /** CSS custom property names from tokens.css. */
  solid: string
  tint: string
  deep: string
}

export const STATE: Record<OperationalState, StateStyle> = {
  occupied: {
    label: 'Seated',
    icon: Users,
    solid: 'var(--color-occupied)',
    tint: 'var(--color-occupied-tint)',
    deep: 'var(--color-occupied-deep)',
  },
  departure_review: {
    label: 'Check departure',
    icon: DoorOpen,
    solid: 'var(--color-review)',
    tint: 'var(--color-review-tint)',
    deep: 'var(--color-review-deep)',
  },
  needs_clearing: {
    label: 'Needs clearing',
    icon: Utensils,
    solid: 'var(--color-clearing)',
    tint: 'var(--color-clearing-tint)',
    deep: 'var(--color-clearing-deep)',
  },
  cleaning: {
    label: 'Cleaning',
    icon: SprayCan,
    solid: 'var(--color-cleaning)',
    tint: 'var(--color-cleaning-tint)',
    deep: 'var(--color-cleaning-deep)',
  },
  ready: {
    label: 'Ready',
    icon: CircleCheck,
    solid: 'var(--color-ready)',
    tint: 'var(--color-ready-tint)',
    deep: 'var(--color-ready-deep)',
  },
}

/** Raw hex values for the 3D scene, which cannot read CSS variables. Keep in sync with tokens.css. */
export const STATE_HEX: Record<OperationalState, string> = {
  occupied: '#3d4fa8',
  departure_review: '#b7791f',
  needs_clearing: '#c8433a',
  cleaning: '#7a4db3',
  ready: '#2d7d4f',
}

export const STATE_ORDER: OperationalState[] = [
  'ready',
  'needs_clearing',
  'departure_review',
  'cleaning',
  'occupied',
]

export const OPEN_TASK: ReadonlySet<TaskStatus> = new Set(['unassigned', 'claimed', 'started'])

export function openTask(entry: TableBoardEntry) {
  return entry.task && OPEN_TASK.has(entry.task.status) ? entry.task : null
}

/** Ready and not blocked: what a host can seat right now. */
export function isAvailable(entry: TableBoardEntry): boolean {
  return entry.session.operational_state === 'ready' && !entry.table.blocked
}

export interface ElapsedAnchor {
  at: string
  /** How the elapsed time reads, e.g. "360 s since departure". */
  phrase: string
}

/** The real timestamp that dates the current state. Returns null rather than inventing one. */
export function elapsedAnchor(entry: TableBoardEntry): ElapsedAnchor | null {
  const { session, task } = entry
  switch (session.operational_state) {
    case 'occupied':
    case 'departure_review':
      return session.seated_at ? { at: session.seated_at, phrase: 'seated' } : null
    case 'needs_clearing':
      return session.departed_at ? { at: session.departed_at, phrase: 'since departure' } : null
    case 'cleaning':
      return task?.started_at ? { at: task.started_at, phrase: 'cleaning' } : null
    case 'ready':
      return session.ready_at ? { at: session.ready_at, phrase: 'ready' } : null
  }
}

export type LedgerGroup = 'attention' | 'clearing' | 'ready' | 'seated' | 'blocked'

export const LEDGER_GROUPS: { id: LedgerGroup; label: string }[] = [
  { id: 'attention', label: 'Needs someone' },
  { id: 'clearing', label: 'Being cleared' },
  { id: 'ready', label: 'Ready to seat' },
  { id: 'seated', label: 'Seated' },
  { id: 'blocked', label: 'Blocked' },
]

export function ledgerGroup(entry: TableBoardEntry): LedgerGroup {
  const state = entry.session.operational_state
  // A blocked table that still needs work stays in the work groups, marked as blocked.
  if (entry.table.blocked && (state === 'ready' || state === 'occupied')) return 'blocked'
  if (state === 'needs_clearing' || state === 'departure_review') return 'attention'
  if (state === 'cleaning') return 'clearing'
  if (state === 'ready') return 'ready'
  return 'seated'
}

/** Natural sort so T2 comes before T10. */
export function compareTableIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}
