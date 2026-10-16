import { useQuery } from '@tanstack/react-query'
import { Download, FileText, Lightbulb } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useBoard } from '@/lib/api/board'
import { apiScopeKey } from '@/lib/api/client'
import { shiftApi } from '@/lib/api/shift'
import type { MetricSummary, ShiftBriefing, ShiftInsights } from '@/lib/api/types'
import { cn } from '@/lib/cn'

const DURATIONS: { metric: string; label: string; help: string }[] = [
  { metric: 'confirmed_departure_to_ready', label: 'Departure to ready', help: 'From staff confirming a departure to the table marked ready' },
  { metric: 'ready_to_seated', label: 'Ready to seated', help: 'How long a ready table waits for the next party' },
  { metric: 'queue_wait', label: 'Queue wait', help: 'From joining the waitlist to being seated' },
  { metric: 'review_to_confirmation', label: 'Camera check to staff answer', help: 'From a camera departure check to staff confirming or keeping the party' },
]

const COUNTS: [string, string][] = [
  ['party_arrived', 'Parties joined the waitlist'],
  ['party_seated', 'Parties seated'],
  ['departure_confirmed', 'Departures confirmed'],
  ['vision_reviews', 'Camera departure checks'],
  ['queue_skip_overrides', 'Queue skips with a reason'],
  ['manual_assignments', 'Seated after a physical check'],
  ['ready_table_leftovers_seen', 'Gemini leftover alerts'],
]

function mins(seconds: number | null | undefined): string {
  if (seconds == null) return 'No data yet'
  return seconds < 60 ? `${Math.round(seconds)} s` : `${(seconds / 60).toFixed(1)} min`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Gemini is unavailable right now.'
}

/** Runs a Gemini request on demand (they cost quota), keeping the last answer. */
function useOnDemand<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fn())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }
  return { data, error, loading, run }
}

function Card({ title, icon, model, children }: { title: string; icon: ReactNode; model?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-rule bg-white p-3.5">
      <h3 className="m-0 mb-2 flex items-center gap-2 text-[14.5px] font-bold">
        {icon}
        {title}
        {model ? (
          <span className="ml-auto rounded-md bg-wash px-1.5 py-0.5 text-[11px] font-semibold text-pewter">{model}</span>
        ) : null}
      </h3>
      {children}
    </section>
  )
}

function DurationRow({ label, help, summary }: { label: string; help: string; summary: MetricSummary | undefined }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2" title={help}>
      <span className="text-[13.5px] font-semibold">{label}</span>
      <span className="text-right">
        <span className="tabular block text-[17px] font-bold">{mins(summary?.median_s)}</span>
        <span className="tabular block text-[12px] text-pewter">
          {summary && summary.count > 0 ? `median, P90 ${mins(summary.p90_s)}, ${summary.count} measured` : 'median'}
        </span>
      </span>
    </li>
  )
}

/** Shift metrics for the current scope, refreshed with each board update. */
export function useShiftMetrics() {
  const { board } = useBoard()
  return useQuery({
    queryKey: ['metrics', apiScopeKey(), board?.generated_at],
    queryFn: shiftApi.metrics,
    enabled: Boolean(board),
    placeholderData: (previous) => previous,
    retry: false,
  })
}

/** The manager's shift report: handoff timings from audit events, plus Gemini summaries on request. */
export function ShiftOverview({ className }: { className?: string }) {
  const metrics = useShiftMetrics()
  const briefing = useOnDemand<ShiftBriefing>(shiftApi.briefing)
  const insights = useOnDemand<ShiftInsights>(shiftApi.insights)
  const [exporting, setExporting] = useState(false)
  const data = metrics.data
  const bySize = Object.entries(data?.queue_wait_by_size ?? {}).filter(([, s]) => s.count > 0)

  async function exportCsv() {
    setExporting(true)
    try {
      await shiftApi.downloadCsv()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-y-auto', className)}>
      <header className="flex items-start gap-3 border-b border-rule px-5 pt-4.5 pb-3.5">
        <div className="flex-1">
          <h2 className="m-0 font-serif text-[23px] leading-tight font-normal whitespace-nowrap">Shift overview</h2>
          <p className="m-0 mt-0.5 text-[13px] text-pewter">Last 12 hours, measured from recorded handoffs</p>
        </div>
        <Button size="sm" tone="secondary" pending={exporting} onClick={exportCsv}>
          <Download aria-hidden />
          Export CSV
        </Button>
      </header>

      <section className="border-b border-rule px-5 py-3" aria-label="Handoff timings">
        {metrics.isError ? (
          <p className="m-0 text-[13.5px] text-clearing-deep">{errorText(metrics.error)}</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-rule p-0">
            {DURATIONS.map((d) => (
              <DurationRow key={d.metric} label={d.label} help={d.help} summary={data?.durations.find((x) => x.metric === d.metric)} />
            ))}
          </ul>
        )}
        {bySize.length ? (
          <p className="m-0 mt-1 text-[12.5px] text-pewter">
            Queue wait by party size:{' '}
            {bySize.map(([size, s], i) => (
              <span key={size} className="tabular">
                {i ? ', ' : ''}
                {size} guests {mins(s.median_s)}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      <section className="border-b border-rule px-5 py-3" aria-label="Shift counts">
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
          {COUNTS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-pewter">{label}</dt>
              <dd className="tabular m-0 text-right font-semibold">{data?.counts[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
        {data?.notes.length ? (
          <details className="mt-2 text-[12.5px] text-pewter">
            <summary className="cursor-pointer font-semibold">How these are measured</summary>
            <ul className="m-0 mt-1 space-y-0.5 pl-4">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <div className="space-y-2.5 px-5 py-4">
        <Card title="Shift briefing" icon={<FileText className="size-4 text-pewter" aria-hidden />} model={briefing.data?.model}>
          {briefing.data ? (
            <div className="text-[13.5px]">
              <p className="m-0 mb-1.5 font-semibold">{briefing.data.briefing.headline}</p>
              <ul className="m-0 mb-1.5 space-y-0.5 pl-4">
                {briefing.data.briefing.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              {briefing.data.briefing.suggestions.map((s) => (
                <p key={s} className="m-0 text-review-deep">
                  {s}
                </p>
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13.5px] text-pewter">Gemini writes a short briefing from the timings and events above.</p>
          )}
          {briefing.error ? <p className="m-0 mt-1.5 text-[13px] text-clearing-deep">{briefing.error}</p> : null}
          <Button size="sm" tone="secondary" className="mt-2" pending={briefing.loading} onClick={briefing.run}>
            {briefing.data ? 'Refresh briefing' : 'Write briefing'}
          </Button>
        </Card>

        <Card title="Efficiency ideas" icon={<Lightbulb className="size-4 text-pewter" aria-hidden />} model={insights.data?.model}>
          {insights.data ? (
            <ul className="m-0 list-none space-y-2 p-0 text-[13.5px]">
              {insights.data.insights.recommendations.map((r) => (
                <li key={r.title}>
                  <p className="m-0 font-semibold">
                    {r.title}{' '}
                    <span className="rounded bg-wash px-1.5 text-[11px] font-semibold text-pewter">{r.effort} effort</span>
                  </p>
                  <p className="m-0 text-pewter">{r.evidence}</p>
                  <p className="m-0">{r.expected_impact}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-pewter">Gemini looks for slow handoffs between a departure and the next seating.</p>
          )}
          {insights.error ? <p className="m-0 mt-1.5 text-[13px] text-clearing-deep">{insights.error}</p> : null}
          <Button size="sm" tone="secondary" className="mt-2" pending={insights.loading} onClick={insights.run}>
            {insights.data ? 'Refresh ideas' : 'Find improvements'}
          </Button>
        </Card>

      </div>
    </div>
  )
}
