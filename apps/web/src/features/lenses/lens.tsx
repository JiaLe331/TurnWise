import { CircleAlert, Cctv, Layers, ListOrdered } from 'lucide-react'
import type { UserRole } from '@/lib/api/types'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { findExceptions } from '@/lib/domain/exceptions'

export type Lens = 'status' | 'clearing' | 'cameras' | 'exceptions'

export const DEFAULT_LENS: Record<UserRole, Lens> = {
  host: 'status',
  floor_staff: 'clearing',
  manager: 'exceptions',
}

const LENSES: { id: Lens; label: string; icon: typeof Layers }[] = [
  { id: 'status', label: 'Status', icon: Layers },
  { id: 'clearing', label: 'Clearing order', icon: ListOrdered },
  { id: 'exceptions', label: 'Exceptions', icon: CircleAlert },
  { id: 'cameras', label: 'Cameras', icon: Cctv },
]

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

export function LensSwitch({ lens, onChange, className }: { lens: Lens; onChange: (l: Lens) => void; className?: string }) {
  const { entries } = useBoard()
  const mapped = entries.filter((e) => e.table.camera_id).length

  return (
    <div
      role="radiogroup"
      aria-label="Floor lens"
      className={cn(
        'flex gap-0.5 overflow-x-auto rounded-[11px] border border-rule bg-white p-[3px] shadow-[0_6px_18px_rgb(27_39_51/0.08)]',
        className,
      )}
    >
      {LENSES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={lens === id}
          onClick={() => onChange(id)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-[7px] text-[14px] font-semibold whitespace-nowrap text-pewter hover:text-ink',
            lens === id && 'bg-ink text-white hover:text-white',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
          {id === 'cameras' ? (
            <span
              className={cn(
                'rounded-[5px] px-1.5 text-[11px] font-semibold',
                lens === id ? 'bg-white/15 text-white' : 'bg-wash text-pewter',
              )}
            >
              {mapped} mapped
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
