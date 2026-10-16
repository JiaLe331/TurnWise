import { Ban, Hand } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { STATE } from '@/lib/domain/status'
import type { FloorLayout } from './layout'

const PAD = 0.45

type Bucket = 'open' | 'seated' | 'clearing' | 'blocked'

const LEGEND: { bucket: Bucket; label: string; color: string }[] = [
  { bucket: 'open', label: 'Open', color: 'var(--color-ready)' },
  { bucket: 'seated', label: 'Seated', color: 'var(--color-occupied)' },
  { bucket: 'clearing', label: 'Clearing', color: 'var(--color-clearing)' },
  { bucket: 'blocked', label: 'Blocked', color: 'var(--color-blocked)' },
]

function bucketOf(e: TableBoardEntry): Bucket {
  if (e.table.blocked) return 'blocked'
  const s = e.session.operational_state
  if (s === 'ready') return 'open'
  if (s === 'needs_clearing' || s === 'cleaning') return 'clearing'
  return 'seated'
}

/** Measures an element so the plan can keep the floor's proportions inside any space. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

interface FloorPlan2DProps {
  layout: FloorLayout
  selectedId: string | null
  onSelect: (id: string) => void
  isDimmed: (entry: TableBoardEntry) => boolean
  order: (id: string) => number | undefined
  heldFor: Map<string, string>
}

/**
 * A top-down host plan drawn from the same layout as the 3D floor, so the two views always agree.
 * Tiles carry state colour plus icon and text; the camera's view shows as a dashed "looks empty".
 */
export function FloorPlan2D({ layout, selectedId, onSelect, isDimmed, order, heldFor }: FloorPlan2DProps) {
  const { entries } = useBoard()
  const [box, size] = useSize<HTMLDivElement>()
  const { minX, maxX, minZ, maxZ } = layout.bounds
  const W = maxX - minX
  const D = maxZ - minZ
  // On a tall screen a wide floor turns 90°, so its long side runs down the page.
  const rotate = size.height > size.width && W > D
  const across = rotate ? D : W
  const down = rotate ? W : D
  // Fit the floor's proportions into the available space (leaving room for the legend).
  const scale = size.width && size.height ? Math.min(size.width / across, (size.height - 36) / down) : 0
  /** Position and size of a floor rectangle (x, z, width along x, depth along z) as percentages. */
  const rect = (x: number, z: number, w: number, d: number) =>
    rotate
      ? { left: `${((z - minZ) / D) * 100}%`, top: `${((x - minX) / W) * 100}%`, width: `${(d / D) * 100}%`, height: `${(w / W) * 100}%` }
      : { left: `${((x - minX) / W) * 100}%`, top: `${((z - minZ) / D) * 100}%`, width: `${(w / W) * 100}%`, height: `${(d / D) * 100}%` }
  const counts = Object.fromEntries(LEGEND.map((l) => [l.bucket, entries.filter((e) => bucketOf(e) === l.bucket).length]))

  return (
    <div ref={box} className="flex h-full w-full flex-col items-center justify-center gap-2">
      {scale > 0 ? (
        <div className="relative" style={{ width: across * scale, height: down * scale }} aria-label="Floor plan">
          {layout.zones.map((zone) => (
            <div
              key={zone.name}
              className={cn('absolute rounded-lg border', zone.outdoor ? 'border-[#d6ccbb] bg-[#efe9df]' : 'border-rule bg-white')}
              style={rect(zone.minX, zone.minZ, zone.maxX - zone.minX, zone.maxZ - zone.minZ)}
            >
              <span className="absolute top-1.5 left-2 text-[12px] font-semibold text-pewter">{zone.name}</span>
            </div>
          ))}
          {entries.map((entry) => {
            const placed = layout.tables.get(entry.table.table_id)
            if (!placed) return null
            return (
              <Tile
                key={entry.table.table_id}
                entry={entry}
                // Table plus its chairs, so the tile reads at a glance.
                style={rect(
                  placed.x - placed.shape.width / 2 - PAD,
                  placed.z - placed.shape.depth / 2 - PAD,
                  placed.shape.width + PAD * 2,
                  placed.shape.depth + PAD * 2,
                )}
                selected={entry.table.table_id === selectedId}
                dimmed={isDimmed(entry)}
                rank={order(entry.table.table_id)}
                held={heldFor.get(entry.table.table_id)}
                onSelect={onSelect}
              />
            )
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 rounded-full bg-white/95 px-3 py-1 text-[12.5px] shadow-[var(--shadow-tag)]">
        {LEGEND.map((l) => (
          <span key={l.bucket} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
            <b className="tabular">{counts[l.bucket]}</b> <span className="text-pewter">{l.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Tile({
  entry,
  style,
  selected,
  dimmed,
  rank,
  held,
  onSelect,
}: {
  entry: TableBoardEntry
  style: CSSProperties
  selected: boolean
  dimmed: boolean
  rank?: number
  held?: string
  onSelect: (id: string) => void
}) {
  const s = STATE[entry.session.operational_state]
  const Icon = s.icon
  const ev = entry.evidence
  // The board waits for staff (and the 30 s rule) before releasing a party; show when the camera
  // already sees the seats empty so the plan never contradicts the footage without saying why.
  const looksEmpty =
    !ev?.stale && ev?.visual_status === 'vacant' && ['occupied', 'departure_review'].includes(entry.session.operational_state)
  const needsCheck =
    entry.session.operational_state === 'ready' &&
    (ev?.table_check?.state === 'leftovers' || (ev?.visual_status === 'occupied' && !ev.stale))

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.table.table_id)}
      aria-pressed={selected}
      aria-label={`${entry.table.table_id}, ${s.label}, ${entry.table.capacity} seats${entry.table.blocked ? ', blocked' : ''}`}
      className={cn(
        'absolute flex min-h-10 min-w-11 flex-col items-center justify-center rounded-lg border-2 text-center transition-opacity',
        entry.table.blocked && 'hatch',
        looksEmpty && 'border-dashed',
        selected && 'ring-2 ring-ink ring-offset-2',
        dimmed && 'opacity-40',
      )}
      style={{ ...style, background: entry.table.blocked ? undefined : s.tint, borderColor: entry.table.blocked ? 'var(--color-blocked)' : s.solid }}
    >
      {rank ? (
        <span className="absolute -top-2 -left-2 grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
          {rank}
        </span>
      ) : null}
      <span className="flex items-center gap-1 leading-none">
        <span className="font-serif text-[15px] text-ink">{entry.table.table_id}</span>
        {entry.table.blocked ? (
          <Ban className="size-3.5 text-blocked" aria-hidden />
        ) : (
          <Icon className="size-3.5" style={{ color: s.solid }} aria-hidden />
        )}
        {entry.session.manual ? <Hand className="size-3" aria-hidden /> : null}
      </span>
      <span className="mt-0.5 text-[10.5px] text-pewter">{entry.table.capacity} seats</span>
      {held ? (
        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-ready-tint px-1.5 text-[10px] font-bold whitespace-nowrap text-ready-deep">
          Held {held}
        </span>
      ) : looksEmpty ? (
        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-dashed border-review bg-white px-1.5 text-[10px] font-bold whitespace-nowrap text-review-deep">
          looks empty
        </span>
      ) : null}
      {needsCheck ? (
        <span className="absolute -top-1.5 -right-1.5 size-3 rounded-full border-2 border-white bg-review" title="Camera or Gemini wants a check" />
      ) : null}
    </button>
  )
}
