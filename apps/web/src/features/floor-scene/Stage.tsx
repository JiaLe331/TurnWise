import { Box, LayoutGrid } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { inLens, useLensSets, type Lens } from '@/features/lenses/lens'
import { TableTag } from '@/features/table/TableTag'
import { TileGrid } from '@/features/table/TileGrid'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-media'
import type { Insets } from './FloorScene'
import { illustrativeLayout, type FloorLayout } from './layout'

const FloorScene = lazy(() => import('./FloorScene'))

const MODE_KEY = 'turnwise.floor-view'
type FloorMode = '3d' | 'grid'

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
      return localStorage.getItem(MODE_KEY) === 'grid' ? 'grid' : '3d'
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
  room,
  azimuth,
}: StageProps) {
  const { entries, serverNow, queuePosition, freshness } = useBoard()
  const { queued, flagged } = useLensSets()
  const [mode, setMode] = useFloorMode()
  const webgl = useMemo(supportsWebGL, [])
  const reducedMotion = usePrefersReducedMotion()
  const changed = useChangedTables(entries)
  const tagEls = useRef(new Map<string, HTMLElement>())

  const isDimmed = useCallback((e: TableBoardEntry) => !inLens(lens, e, queued, flagged), [lens, queued, flagged])
  const order = (id: string) => (lens === 'clearing' ? queuePosition.get(id) : undefined)

  // Only the table set shapes the layout; state changes never move a table.
  const shapeKey = entries.map((e) => `${e.table.table_id}:${e.table.zone}:${e.table.capacity}:${e.table.attributes.join(',')}`).join('|')
  const illustrative = useMemo(() => illustrativeLayout(entries), [shapeKey])
  const layout = layoutOverride ?? illustrative

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
              room={room}
              azimuth={azimuth}
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
                  pulse={changed.has(entry.table.table_id)}
                  onSelect={onSelect}
                  tabIndex={-1}
                />
              </div>
            ))}
          </div>
        </>
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
      {webgl && !compact ? (
        <button
          type="button"
          onClick={() => setMode(use3d ? 'grid' : '3d')}
          className="absolute z-10 flex items-center gap-1.5 rounded-[9px] border border-rule bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink shadow-[var(--shadow-tag)] hover:bg-wash"
          style={{ right: (insets.right ?? 0) + 16, bottom: 16 }}
        >
          {use3d ? <LayoutGrid className="size-4" aria-hidden /> : <Box className="size-4" aria-hidden />}
          {use3d ? 'Grid view' : 'Floor view'}
        </button>
      ) : null}
    </div>
  )
}
