import { CloudOff, FlaskConical, RefreshCw } from 'lucide-react'
import { IS_DEMO_OUTLET } from '@/config'
import { useBoard } from '@/lib/api/board'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/domain/time'

export function DataModeBadge({ compact = false }: { compact?: boolean }) {
  if (!IS_DEMO_OUTLET) return null
  return (
    <span
      className="demo-stripes inline-flex items-center gap-1.5 rounded-full border border-demo-rule px-2.5 py-1 text-[13px] font-semibold text-demo"
      title="Seeded tables. They reset when the API restarts."
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {compact ? 'Demo' : 'Demo data'}
      <span className="sr-only">. Seeded tables that reset when the API restarts.</span>
    </span>
  )
}

export function FreshnessIndicator({ className }: { className?: string }) {
  // The board context re-renders every second, which keeps the seconds count current.
  const { freshness, lastUpdated } = useBoard()
  const ago = lastUpdated ? Math.max(0, Math.round((Date.now() - lastUpdated) / 1000)) : null
  const label =
    freshness === 'loading'
      ? 'Connecting'
      : freshness === 'offline'
        ? 'Offline'
        : freshness === 'delayed'
          ? 'Updates delayed'
          : ago !== null && ago <= 2
            ? 'Updated just now'
            : `Updated ${ago}s ago`
  const dot = {
    loading: 'bg-pewter',
    live: 'bg-ready shadow-[0_0_0_3px_rgb(45_125_79/0.15)]',
    delayed: 'bg-review shadow-[0_0_0_3px_rgb(183_121_31/0.18)]',
    offline: 'bg-clearing shadow-[0_0_0_3px_rgb(200_67_58/0.18)]',
  }[freshness]
  return (
    <span className={cn('inline-flex items-center gap-2 text-[13px] font-medium text-pewter', className)} role="status">
      <span className={cn('size-2 rounded-full', dot)} aria-hidden />
      <span className="tabular">{label}</span>
    </span>
  )
}

export function OfflineBanner() {
  const { freshness, lastUpdated, firstLoadError, refetch } = useBoard()
  if (freshness !== 'offline') return null
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-clearing/30 bg-clearing-tint px-4 py-2.5 text-[14px] text-clearing-deep sm:px-5"
    >
      <CloudOff className="size-4 shrink-0" aria-hidden />
      <span className="font-semibold">Can't reach TurnWise.</span>
      <span className="flex-1">
        {lastUpdated && !firstLoadError
          ? `Showing the board from ${formatClock(lastUpdated)}. Actions are paused until the connection returns.`
          : import.meta.env.DEV
            ? 'Start the API with: cd backend && uv run uvicorn turnwise.api.main:app --reload --port 8000'
            : 'The board will load when the connection returns.'}
      </span>
      <button
        type="button"
        onClick={refetch}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold hover:bg-white/60"
      >
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </button>
    </div>
  )
}
