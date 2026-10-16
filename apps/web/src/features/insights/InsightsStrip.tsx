import { ChartLine } from 'lucide-react'
import { useState } from 'react'
import { Dialog, SheetContent } from '@/components/ui/dialog'
import { ShiftOverview, useShiftMetrics } from '@/features/manager/ShiftOverview'
import { useBoard } from '@/lib/api/board'
import { waitlistOf } from '@/lib/api/seating'
import { cn } from '@/lib/cn'

function minutes(seconds: number | null | undefined): string {
  return seconds == null ? '–' : (seconds / 60).toFixed(1)
}

/** The manager's live shift numbers above the floor, with the full shift report a click away. */
export function InsightsStrip({ className }: { className?: string }) {
  const { board } = useBoard()
  const metrics = useShiftMetrics()
  const [open, setOpen] = useState(false)
  const median = (metric: string) => metrics.data?.durations.find((d) => d.metric === metric)?.median_s
  const waiting = waitlistOf(board).filter((p) => p.status === 'waiting').length
  const items: [string, string, string][] = [
    ['Queue wait', minutes(median('queue_wait')), 'min'],
    ['Clear to ready', minutes(median('confirmed_departure_to_ready')), 'min'],
    ['Ready to seat', minutes(median('ready_to_seated')), 'min'],
    ['Waiting now', String(waiting), waiting === 1 ? 'party' : 'parties'],
  ]

  return (
    <>
      <div
        className={cn(
          'flex items-stretch overflow-x-auto rounded-xl border border-rule bg-white whitespace-nowrap shadow-[0_6px_18px_rgb(27_39_51/0.08)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          className,
        )}
        aria-label="Shift numbers"
      >
        {items.map(([label, value, unit]) => (
          <div key={label} className="shrink-0 border-r border-rule px-2.5 py-1.5">
            <div className="text-[11px] font-semibold text-pewter">{label}</div>
            <div className="tabular text-[15px] font-bold">
              {value}
              {value === '–' ? null : <span className="ml-0.5 text-[11.5px] font-semibold text-pewter">{unit}</span>}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the shift report"
          className="flex shrink-0 items-center gap-1.5 px-3 text-[13px] font-semibold text-ink hover:bg-wash"
        >
          <ChartLine className="size-4" aria-hidden />
          Report
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <SheetContent side="right" title="Shift report">
            <ShiftOverview className="min-h-0 flex-1" />
          </SheetContent>
        ) : null}
      </Dialog>
    </>
  )
}
