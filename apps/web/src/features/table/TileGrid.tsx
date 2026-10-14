import { Ban, Hand } from 'lucide-react'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { elapsedAnchor, STATE } from '@/lib/domain/status'
import { formatMinutes, minutesSince } from '@/lib/domain/time'

interface TileGridProps {
  selectedId: string | null
  onSelect: (id: string) => void
  isDimmed: (entry: TableBoardEntry) => boolean
  order: (id: string) => number | undefined
  className?: string
}

/** Zone-grouped table tiles: the stage when WebGL is unavailable or the floor view is turned off. */
export function TileGrid({ selectedId, onSelect, isDimmed, order, className }: TileGridProps) {
  const { entries, serverNow } = useBoard()
  const zones = [...new Set(entries.map((e) => e.table.zone))]

  return (
    <div className={cn('overflow-y-auto', className)}>
      {zones.map((zone) => (
        <section key={zone} aria-label={zone} className="mb-5">
          <h3 className="m-0 mb-2 text-[13px] font-semibold text-pewter">{zone}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5">
            {entries
              .filter((e) => e.table.zone === zone)
              .map((entry) => {
                const { table, session } = entry
                const s = STATE[session.operational_state]
                const Icon = s.icon
                const anchor = elapsedAnchor(entry)
                const n = order(table.table_id)
                return (
                  <button
                    key={table.table_id}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onSelect(table.table_id)}
                    className={cn(
                      'relative flex flex-col items-start gap-1 overflow-hidden rounded-[10px] border border-rule bg-white p-3 pl-4 text-left',
                      table.blocked && 'hatch',
                      selectedId === table.table_id && 'border-2 border-ink',
                      isDimmed(entry) && 'opacity-50',
                    )}
                  >
                    <span
                      className="absolute inset-y-0 left-0 w-1.5"
                      style={{ background: table.blocked ? 'var(--color-blocked)' : s.solid }}
                      aria-hidden
                    />
                    <span className="flex w-full items-center gap-1.5">
                      {n ? (
                        <span className="grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
                          {n}
                        </span>
                      ) : null}
                      <span className="font-serif text-[26px] leading-none">{table.table_id}</span>
                      <span className="ml-auto text-[12.5px] font-semibold text-pewter">{table.capacity} seats</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                      <Icon className="size-4" style={{ color: s.solid }} aria-hidden />
                      {s.label}
                      {table.blocked ? <Ban className="size-3.5 text-blocked" aria-label="Blocked" /> : null}
                      {session.manual ? <Hand className="size-3.5" aria-label="Manual override" /> : null}
                    </span>
                    <span className="tabular text-[12.5px] font-medium text-pewter">
                      {anchor ? `${formatMinutes(minutesSince(anchor.at, serverNow))} ${anchor.phrase}` : ' '}
                    </span>
                  </button>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
