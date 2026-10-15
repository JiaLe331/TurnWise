import { Box, LayoutGrid, Map as MapIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { inLens, useLensSets, type Lens } from '@/features/lenses/lens'
import { TableTag } from '@/features/table/TableTag'
import { TileGrid } from '@/features/table/TileGrid'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-media'
import type { Insets } from './FloorScene'
import { FloorPlan2D } from './FloorPlan2D'
import { useFloorModel } from './floorModel'
import { illustrativeLayout, type FloorLayout } from './layout'

const FloorScene = lazy(() => import('./FloorScene'))

const MODE_KEY = 'turnwise.floor-view'
type FloorMode = '3d' | 'plan' | 'grid'
const FLOOR_MODES: FloorMode[] = ['3d', 'plan', 'grid']

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function useFloorMode(): [FloorMode, (mode: FloorMode) => void] {
  const [mode, setMode] = useState<FloorMode>(() => {
    try {
      const stored = localStorage.getItem(MODE_KEY) as FloorMode | null
      return stored && FLOOR_MODES.includes(stored) ? stored : '3d'
    } catch {
      return '3d'
    }
  })
  const update = useCallback((next: FloorMode) => {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // Storage unavailable; the choice lasts for this page only.
    }
  }, [])
  return [mode, update]
}

/** Tables whose state changed since the previous poll, highlighted for a moment. */
function useChangedTables(entries: TableBoardEntry[]): Set<string> {
  const previous = useRef<Map<string, string> | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())
  useEffect(() => {
    const now = new Map(entries.map((e) => [e.table.table_id, `${e.session.operational_state}|${e.table.blocked}`]))
    const before = previous.current
    previous.current = now
    if (!before || entries.length === 0) return
    const ids = [...now].filter(([id, sig]) => before.has(id) && before.get(id) !== sig).map(([id]) => id)
    if (ids.length === 0) return
    setChanged(new Set(ids))
    const timer = window.setTimeout(() => setChanged(new Set()), 2000)
    return () => window.clearTimeout(timer)
  }, [entries])
  return changed
}

interface StageProps {
  lens: Lens
  selectedId: string | null
  onSelect: (id: string) => void
  insets?: Insets
  /** Small embedded floor: tags only for the lens's tables, camera frames the selection. */
  compact?: boolean
  className?: string
  /** Fixed floor plan (e.g. built from camera footage) instead of the illustrative grid. */
  layoutOverride?: FloorLayout
  /** Tables to highlight in rank order (e.g. seating suggestions); overrides the lens dimming. */
  spotlight?: string[]
  room?: ReactNode
  azimuth?: number
}

export function Stage({
  lens,
  selectedId,
  onSelect,
  insets = {},
  compact = false,
  className,
  layoutOverride,
  spotlight,
  room,
  azimuth,
}: StageProps) {
  const { board, entries, serverNow, queuePosition, freshness } = useBoard()
  const { queued, flagged } = useLensSets()
  const [mode, setMode] = useFloorMode()
  const webgl = useMemo(supportsWebGL, [])
  const reducedMotion = usePrefersReducedMotion()
  const changed = useChangedTables(entries)
  const tagEls = useRef(new Map<string, HTMLElement>())

  const spotlightKey = spotlight?.join(',')
  const isDimmed = useCallback(
    (e: TableBoardEntry) =>
      spotlight ? !spotlight.includes(e.table.table_id) : !inLens(lens, e, queued, flagged),
    [lens, queued, flagged, spotlightKey], // spotlight compared by value
  )
  const order = (id: string) => {
    if (spotlight) {
      const rank = spotlight.indexOf(id)
      return rank >= 0 ? rank + 1 : undefined
    }
    return lens === 'clearing' ? queuePosition.get(id) : undefined
  }
  const heldFor = useMemo(() => {
    const codes = new Map((board?.waitlist ?? []).map((p) => [p.party_id, p.queue_code]))
    return new Map((board?.holds ?? []).filter((h) => h.status === 'active').map((h) => [h.table_id, codes.get(h.party_id) ?? 'party']))
  }, [board])

  // Only the table set shapes the layout; state changes never move a table.
  const shapeKey = entries.map((e) => `${e.table.table_id}:${e.table.zone}:${e.table.capacity}:${e.table.attributes.join(',')}`).join('|')
  const illustrative = useMemo(() => illustrativeLayout(entries), [shapeKey])
  const model = useFloorModel()
  const layout = layoutOverride ?? model.layout ?? illustrative
  const sceneRoom = room ?? model.room
  const sceneAzimuth = azimuth ?? model.azimuth

  const tagged = compact ? entries.filter((e) => !isDimmed(e) || e.table.table_id === selectedId) : entries
  const tagKey = tagged.map((e) => e.table.table_id).join(',')
  const use3d = webgl && mode === '3d'

  return (
    <div className={cn('overflow-hidden', freshness === 'offline' && 'grayscale-[0.6]', className)}>
      {use3d ? (
        <>
          <Suspense fallback={<div className="absolute inset-0 animate-pulse bg-linen" aria-hidden />}>
            <FloorScene
              layout={layout}
              entries={entries}
              selectedId={selectedId}
              isDimmed={isDimmed}
              onSelect={onSelect}
              insets={insets}
              focusId={compact ? selectedId : null}
              focusZoom={1.7}
              reducedMotion={reducedMotion}
              tagEls={tagEls}
              tagKey={tagKey}
              room={sceneRoom}
              azimuth={sceneAzimuth}
            />
          </Suspense>
          {/* Pointer shortcut only: the ledger is the keyboard and screen-reader path to every table. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {tagged.map((entry) => (
              <div
                key={entry.table.table_id}
                ref={(el) => {
                  if (el) tagEls.current.set(entry.table.table_id, el)
                  else tagEls.current.delete(entry.table.table_id)
                }}
                className="pointer-events-auto absolute top-0 left-0"
                style={{ visibility: 'hidden' }}
              >
                <TableTag
                  entry={entry}
                  serverNow={serverNow}
                  selected={entry.table.table_id === selectedId}
                  dimmed={isDimmed(entry)}
                  compact={compact || isDimmed(entry)}
                  order={order(entry.table.table_id)}
                  held={heldFor.get(entry.table.table_id)}
                  pulse={changed.has(entry.table.table_id)}
                  onSelect={onSelect}
                  tabIndex={-1}
                />
              </div>
            ))}
          </div>
        </>
      ) : mode === 'plan' && !compact ? (
        <div
          className="absolute inset-0"
          style={{
            paddingLeft: (insets.left ?? 0) + 24,
            paddingRight: (insets.right ?? 0) + 24,
            paddingTop: (insets.top ?? 0) + 12,
            paddingBottom: (insets.bottom ?? 0) + 12,
          }}
        >
          <FloorPlan2D layout={layout} selectedId={selectedId} onSelect={onSelect} isDimmed={isDimmed} order={order} heldFor={heldFor} />
        </div>
      ) : (
        <div
          className="absolute inset-0 overflow-y-auto"
          style={{
            paddingLeft: (insets.left ?? 0) + 16,
            paddingRight: (insets.right ?? 0) + 16,
            paddingTop: (insets.top ?? 0) + 8,
            paddingBottom: (insets.bottom ?? 0) + 8,
          }}
        >
          <TileGrid selectedId={selectedId} onSelect={onSelect} isDimmed={isDimmed} order={order} />
        </div>
      )}
      {!compact ? (
        <div
          role="radiogroup"
          aria-label="Floor view"
          className="absolute z-10 flex gap-0.5 rounded-[10px] border border-rule bg-white p-0.5 shadow-[var(--shadow-tag)]"
          style={{ right: (insets.right ?? 0) + 16, bottom: 16 }}
        >
          {(
            [
              ['3d', '3D', Box],
              ['plan', 'Plan', MapIcon],
              ['grid', 'Grid', LayoutGrid],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = id === '3d' ? use3d : mode === id || (id === 'grid' && mode === '3d' && !webgl)
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={id === '3d' && !webgl}
                title={id === '3d' && !webgl ? '3D needs WebGL, which this browser lacks' : undefined}
                onClick={() => setMode(id)}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold',
                  active ? 'bg-ink text-white' : 'text-pewter hover:text-ink disabled:opacity-40',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
