import { Ban, Hand } from 'lucide-react'
import type { CSSProperties, Ref } from 'react'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { elapsedAnchor, STATE } from '@/lib/domain/status'
import { minutesSince } from '@/lib/domain/time'
import { initialsFor } from '@/lib/identity/personas'

interface TableTagProps {
  entry: TableBoardEntry
  serverNow: number
  selected?: boolean
  dimmed?: boolean
  compact?: boolean
  order?: number
  /** Queue code of the party this table is held for. */
  held?: string
  /** Briefly highlights the tag after a polled state change. */
  pulse?: boolean
  onSelect?: (id: string) => void
  style?: CSSProperties
  className?: string
  tabIndex?: number
  ref?: Ref<HTMLButtonElement>
}

/** The table's label in the floor scene and the fallback grid. */
export function TableTag({
  entry,
  serverNow,
  selected,
  dimmed,
  compact,
  order,
  held,
  pulse,
  onSelect,
  style,
  className,
  tabIndex,
  ref,
}: TableTagProps) {
  const { table, session, task } = entry
  const s = STATE[session.operational_state]
  const Icon = s.icon
  const anchor = elapsedAnchor(entry)
  const minutes = anchor ? minutesSince(anchor.at, serverNow) : null
  const owner = task && (task.status === 'claimed' || task.status === 'started') ? task.owner_id : null
  const bar = dimmed ? '#aeb6b2' : table.blocked ? 'var(--color-blocked)' : s.solid

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      onClick={() => onSelect?.(table.table_id)}
      aria-label={`${table.table_id}, ${s.label}${table.blocked ? ', blocked' : ''}`}
      aria-pressed={selected}
      className={cn(
        'flex items-center gap-1.5 rounded-[9px] border border-rule bg-white py-1 pr-2 pl-1.5 text-[13px] font-semibold whitespace-nowrap text-ink shadow-[var(--shadow-tag)] transition-[opacity,transform] duration-200',
        selected && 'border-2 border-ink py-1.5 pr-2.5 shadow-[0_6px_16px_rgb(27_39_51/0.18)]',
        dimmed && 'opacity-55',
        pulse && 'animate-[tag-pulse_900ms_ease-out_2]',
        className,
      )}
      style={style}
    >
      <span className="w-1 self-stretch rounded-sm" style={{ background: bar }} aria-hidden />
      {order ? (
        <span className="grid size-[18px] place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
          {order}
        </span>
      ) : null}
      <span className={cn('font-serif font-normal', selected ? 'text-[18px]' : 'text-[15px]')}>
        {table.table_id}
      </span>
      {table.blocked ? (
        <Ban className="size-[15px] text-blocked" aria-hidden />
      ) : (
        <Icon className="size-[15px]" style={{ color: dimmed ? '#8a949b' : s.solid }} aria-hidden />
      )}
      {session.manual ? <Hand className="size-[14px] text-ink" aria-label="Manual override" /> : null}
      {!compact && minutes !== null ? (
        <span className="tabular font-medium text-pewter">{minutes < 1 ? 'now' : `${minutes}m`}</span>
      ) : null}
      {!compact && owner ? (
        <span className="rounded-[5px] bg-cleaning-tint px-1 text-[10.5px] text-cleaning-deep">
          {initialsFor(owner)}
        </span>
      ) : null}
      {held ? (
        <span className="rounded-[5px] bg-ready-tint px-1 text-[10.5px] text-ready-deep">Held {held}</span>
      ) : null}
    </button>
  )
}
