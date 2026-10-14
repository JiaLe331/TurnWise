import { Ban, Hand } from 'lucide-react'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { findExceptions } from '@/lib/domain/exceptions'
import {
  elapsedAnchor,
  LEDGER_GROUPS,
  ledgerGroup,
  openTask,
  STATE,
  STATE_ORDER,
} from '@/lib/domain/status'
import { formatMinutes, minutesSince } from '@/lib/domain/time'
import type { Lens } from '@/features/lenses/lens'

interface Section {
  id: string
  label: string
  rows: { entry: TableBoardEntry; order?: number; note?: string }[]
}

function sectionsFor(lens: Lens, entries: TableBoardEntry[], queue: TableBoardEntry[], serverNow: number): Section[] {
  const byGroup = (exclude: Set<string>) =>
    LEDGER_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      rows: entries
        .filter((e) => ledgerGroup(e) === g.id && !exclude.has(e.table.table_id))
        .sort(sortWithinGroup(serverNow))
        .map((entry) => ({ entry })),
    }))

  if (lens === 'clearing') {
    const queued = new Set(queue.map((e) => e.table.table_id))
    return [
      {
        id: 'queue',
        label: 'Clearing order',
        rows: queue.map((entry, i) => ({ entry, order: i + 1 })),
      },
      ...byGroup(queued),
    ]
  }

  if (lens === 'exceptions') {
    const exceptions = findExceptions(entries, serverNow)
    const flagged = new Set(exceptions.map((x) => x.entry.table.table_id))
    return [
      {
        id: 'exceptions',
        label: 'Exceptions',
        rows: exceptions.map((x) => ({ entry: x.entry, note: x.label })),
      },
      ...byGroup(flagged),
    ]
  }

  return byGroup(new Set())
}

/** Longest-waiting first inside a group, so the oldest work rises to the top. */
function sortWithinGroup(serverNow: number) {
  return (a: TableBoardEntry, b: TableBoardEntry) => {
    const am = elapsedAnchor(a)
    const bm = elapsedAnchor(b)
    return (bm ? minutesSince(bm.at, serverNow) : -1) - (am ? minutesSince(am.at, serverNow) : -1)
  }
}

export function StatusStrip() {
  const { entries } = useBoard()
  const counts = STATE_ORDER.map((state) => ({
    state,
    count: entries.filter((e) => e.session.operational_state === state).length,
  }))
  const blocked = entries.filter((e) => e.table.blocked).length
  const total = entries.length || 1

  return (
    <div>
      <div className="mt-3 mb-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" aria-hidden>
        {counts
          .filter((c) => c.count > 0)
          .map((c) => (
            <span key={c.state} style={{ flex: c.count / total, background: STATE[c.state].solid }} />
          ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0 text-[13px] font-medium text-pewter">
        {counts.map(({ state, count }) => {
          const Icon = STATE[state].icon
          return (
            <li key={state} className="flex items-center gap-1.5">
              <Icon className="size-3.5" style={{ color: STATE[state].solid }} aria-hidden />
              <b className="tabular text-ink">{count}</b>
              {STATE[state].label}
            </li>
          )
        })}
        {blocked ? (
          <li className="flex items-center gap-1.5">
            <Ban className="size-3.5 text-blocked" aria-hidden />
            <b className="tabular text-ink">{blocked}</b>
            Blocked
          </li>
        ) : null}
      </ul>
    </div>
  )
}

interface LedgerProps {
  lens: Lens
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
}

export function Ledger({ lens, selectedId, onSelect, className }: LedgerProps) {
  const { entries, board, serverNow, freshness } = useBoard()
  const sections = sectionsFor(lens, entries, board?.clearing_queue ?? [], serverNow)

  return (
    <nav aria-label="Tables" className={cn('flex min-h-0 flex-col', className)}>
      <div className="border-b border-rule px-4 pt-4 pb-3.5">
        <h2 className="m-0 text-[17px] font-bold">Demo outlet floor</h2>
        <StatusStrip />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-3">
        {freshness === 'loading'
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="mx-2 my-3 h-9 animate-pulse rounded-lg bg-wash" aria-hidden />
            ))
          : sections.map((section) =>
              section.rows.length === 0 ? null : (
                <section key={section.id} aria-label={section.label}>
                  <h3 className="m-0 px-2 pt-3 pb-1.5 text-[13px] font-semibold text-pewter">
                    {section.label}
                  </h3>
                  <ul className="m-0 list-none p-0">
                    {section.rows.map(({ entry, order, note }) => (
                      <li key={`${section.id}-${entry.table.table_id}-${note ?? ''}`}>
                        <LedgerRow
                          entry={entry}
                          order={order}
                          note={note}
                          serverNow={serverNow}
                          selected={entry.table.table_id === selectedId}
                          onSelect={onSelect}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
        {freshness !== 'loading' && lens === 'exceptions' && sections[0]?.rows.length === 0 ? (
          <p className="mx-2 my-2 rounded-lg bg-wash px-3 py-2.5 text-[13.5px] text-pewter">
            No exceptions right now.
          </p>
        ) : null}
      </div>
    </nav>
  )
}

interface RowProps {
  entry: TableBoardEntry
  serverNow: number
  selected: boolean
  order?: number
  note?: string
  onSelect: (id: string) => void
}

function LedgerRow({ entry, serverNow, selected, order, note, onSelect }: RowProps) {
  const { table, session } = entry
  const s = STATE[session.operational_state]
  const Icon = s.icon
  const anchor = elapsedAnchor(entry)
  const task = openTask(entry)
  const who = task ? (task.owner_id ?? 'unassigned') : null
  const sub = note ?? [table.zone, `${table.capacity} seats`, who].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={() => onSelect(table.table_id)}
      aria-current={selected || undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[9px] px-2 py-[7px] text-left hover:bg-wash',
        selected && 'bg-wash shadow-[inset_0_0_0_2px_var(--color-ink)]',
      )}
    >
      <span
        className="h-[30px] w-1 shrink-0 rounded-sm"
        style={{ background: table.blocked ? 'var(--color-blocked)' : s.solid }}
        aria-hidden
      />
      {order ? (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
          {order}
        </span>
      ) : null}
      <span className="w-10 shrink-0 font-serif text-[19px]">{table.table_id}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          <Icon className="size-[15px] shrink-0" style={{ color: s.solid }} aria-hidden />
          {s.label}
          {table.blocked ? <Ban className="size-3.5 text-blocked" aria-label="Blocked" /> : null}
          {session.manual ? <Hand className="size-3.5" aria-label="Manual override" /> : null}
        </span>
        <span className="block truncate text-[12.5px] font-medium text-pewter">{sub}</span>
      </span>
      <span className="tabular shrink-0 text-[13px] font-semibold text-pewter">
        {anchor ? formatMinutes(minutesSince(anchor.at, serverNow)) : ''}
      </span>
    </button>
  )
}
