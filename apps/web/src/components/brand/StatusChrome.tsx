import { CloudOff, RefreshCw } from 'lucide-react'
import { useBoard } from '@/lib/api/board'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/domain/time'

/** Speaks up only when board updates fall behind; offline has its own banner. */
export function FreshnessIndicator({ className }: { className?: string }) {
  const { freshness } = useBoard()
  if (freshness !== 'delayed') return null
  return (
    <span className={cn('inline-flex items-center gap-2 text-[13px] font-medium text-pewter', className)} role="status">
      <span className="size-2 rounded-full bg-review shadow-[0_0_0_3px_rgb(183_121_31/0.18)]" aria-hidden />
      Updates delayed
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
