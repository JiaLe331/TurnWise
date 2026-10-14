import { useQuery } from '@tanstack/react-query'
import { Lightbulb, MessageSquare, Send, Sparkles } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useBoard } from '@/lib/api/board'
import { apiScopeKey } from '@/lib/api/client'
import type { ShiftAnswer, ShiftBriefing, ShiftInsights } from '@/lib/api/types'
import { outletApi } from './api'

const METRIC_LABEL: Record<string, string> = {
  confirmed_departure_to_ready: 'Departure → ready',
  review_to_confirmation: 'Camera review → staff confirm',
  ready_to_seated: 'Ready → seated',
  queue_wait: 'Queue wait',
}
const COUNT_LABEL: [string, string][] = [
  ['vision_reviews', 'Camera departure reviews'],
  ['departure_confirmed', 'Departures confirmed'],
  ['party_seated', 'Parties seated'],
  ['occupancy_on_ready_table', 'Guests at a ready table'],
  ['ready_table_leftovers_seen', 'Gemini leftover alerts'],
]

function minutes(seconds: number | null) {
  return seconds == null ? '—' : `${(seconds / 60).toFixed(1)} min`
}

function AiCard({ title, icon, children, model }: { title: string; icon: ReactNode; children: ReactNode; model?: string }) {
  return (
    <section className="rounded-xl border border-rule bg-white p-3">
      <h3 className="m-0 mb-2 flex items-center gap-2 text-[15px] font-bold">
        {icon}
        {title}
        {model ? <span className="ml-auto rounded-md bg-wash px-2 py-0.5 text-[11px] font-semibold text-pewter">Gemini · {model}</span> : null}
      </h3>
      {children}
    </section>
  )
}

function useAi<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gemini is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }
  return { data, error, loading, run }
}

export function ManagerPanel() {
  const { board } = useBoard()
  const metrics = useQuery({
    queryKey: ['metrics', apiScopeKey(), board?.generated_at],
    queryFn: outletApi.metrics,
    enabled: !!board,
    placeholderData: (prev) => prev,
  }).data
  const briefing = useAi<ShiftBriefing>(outletApi.briefing)
  const insights = useAi<ShiftInsights>(outletApi.insights)
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<ShiftAnswer[]>([])
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  async function ask(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (q.length < 3) return
    setAsking(true)
    setAskError(null)
    try {
      const a = await outletApi.ask(q)
      setAnswers((prev) => [a, ...prev].slice(0, 4))
      setQuestion('')
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Gemini is unavailable right now.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr_1.1fr]">
      <section aria-label="Shift metrics" className="rounded-xl border border-rule bg-white p-3">
        <h3 className="m-0 mb-2 text-[15px] font-bold">Shift metrics <span className="text-[12px] font-normal text-pewter">demo clock</span></h3>
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
          {(metrics?.durations ?? []).map((d) => (
            <div key={d.metric} className="contents">
              <dt className="text-pewter">{METRIC_LABEL[d.metric] ?? d.metric}</dt>
              <dd className="m-0 text-right font-semibold">
                {minutes(d.median_s)} <span className="font-normal text-pewter">n={d.count}</span>
              </dd>
            </div>
          ))}
          {COUNT_LABEL.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-pewter">{label}</dt>
              <dd className="m-0 text-right font-semibold">{metrics?.counts[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="space-y-3">
        <AiCard title="Shift briefing" icon={<Sparkles className="size-4 text-review" aria-hidden />} model={briefing.data?.model}>
          {briefing.data ? (
            <div className="text-[14px]">
              <p className="m-0 mb-1.5 font-semibold">{briefing.data.briefing.headline}</p>
              <ul className="m-0 mb-1.5 space-y-0.5 pl-4">
                {briefing.data.briefing.highlights.map((h) => <li key={h}>{h}</li>)}
              </ul>
              {briefing.data.briefing.suggestions.map((s) => <p key={s} className="m-0 text-review-deep">→ {s}</p>)}
            </div>
          ) : (
            <p className="m-0 mb-2 text-[14px] text-pewter">Gemini summarises the shift from the metrics and events above.</p>
          )}
          {briefing.error ? <p className="m-0 text-[13px] text-clearing-deep">{briefing.error}</p> : null}
          <Button size="sm" tone="secondary" className="mt-2" pending={briefing.loading} onClick={briefing.run}>
            {briefing.data ? 'Refresh briefing' : 'Generate briefing'}
          </Button>
        </AiCard>

        <AiCard title="Efficiency ideas" icon={<Lightbulb className="size-4 text-review" aria-hidden />} model={insights.data?.model}>
          {insights.data ? (
            <ul className="m-0 list-none space-y-2 p-0 text-[14px]">
              {insights.data.insights.recommendations.map((r) => (
                <li key={r.title}>
                  <p className="m-0 font-semibold">
                    {r.title} <span className="rounded bg-wash px-1.5 text-[11px] font-semibold text-pewter">{r.effort} effort</span>
                  </p>
                  <p className="m-0 text-pewter">{r.evidence}</p>
                  <p className="m-0">{r.expected_impact}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mb-2 text-[14px] text-pewter">Gemini looks for bottlenecks between departure and the next seating.</p>
          )}
          {insights.error ? <p className="m-0 text-[13px] text-clearing-deep">{insights.error}</p> : null}
          <Button size="sm" tone="secondary" className="mt-2" pending={insights.loading} onClick={insights.run}>
            {insights.data ? 'Refresh ideas' : 'Find improvements'}
          </Button>
        </AiCard>
      </div>

      <AiCard title="Ask the shift" icon={<MessageSquare className="size-4 text-review" aria-hidden />} model={answers[0]?.model}>
        <form onSubmit={ask} className="mb-2 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which table is slowing us down?"
            className="h-9 flex-1 rounded-lg border border-rule bg-white px-3 text-[14px]"
            aria-label="Question for Gemini"
            maxLength={300}
          />
          <Button size="sm" tone="primary" type="submit" pending={asking} aria-label="Ask Gemini">
            <Send aria-hidden />
          </Button>
        </form>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {['What should staff do next?', 'Why is anyone still waiting?', 'Any tables with leftovers?'].map((q) => (
            <button key={q} type="button" onClick={() => setQuestion(q)} className="rounded-full border border-rule px-2.5 py-1 text-[12px] hover:bg-wash">
              {q}
            </button>
          ))}
        </div>
        {askError ? <p className="m-0 text-[13px] text-clearing-deep">{askError}</p> : null}
        <ul className="m-0 max-h-56 list-none space-y-2 overflow-y-auto p-0">
          {answers.map((a) => (
            <li key={a.question + a.result.answer} className="rounded-lg bg-wash p-2 text-[14px]">
              <p className="m-0 font-semibold">{a.question}</p>
              <p className="m-0">{a.result.answer}</p>
              <p className="m-0 text-[12px] text-pewter">Based on: {a.result.facts_used.join(', ') || 'no matching facts'}</p>
            </li>
          ))}
        </ul>
      </AiCard>
    </div>
  )
}
