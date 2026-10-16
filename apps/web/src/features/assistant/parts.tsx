import { Check, LoaderCircle } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { AssistantPart, Chart } from './types'

const LOOKUP_LABEL: Record<string, string> = {
  'tool-get_shift_metrics': 'Read shift metrics',
  'tool-get_floor_now': 'Checked the floor',
  'tool-get_recent_events': 'Read recent events',
}

/** What the assistant looked up, as a quiet chip. Null for parts that aren't lookups. */
export function lookupLabel(part: AssistantPart): string | null {
  if (part.type === 'tool-get_table') return `Looked up ${part.input?.table_id ?? 'a table'}`
  return LOOKUP_LABEL[part.type] ?? null
}

export function LookupChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[11.5px] text-pewter">
      {done ? <Check className="size-3 text-ready" aria-hidden /> : <LoaderCircle className="size-3 animate-spin" aria-hidden />}
      {label}
    </span>
  )
}

/** Gemini's light markdown: **bold** inline, "- " lines as a list. */
export function AnswerText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let items: string[] = []
  const flush = () => {
    if (items.length) blocks.push(<ul key={blocks.length} className="m-0 mb-2 space-y-0.5 pl-4">{items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>)
    items = []
  }
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      items.push(bullet[1])
      continue
    }
    flush()
    if (line.trim()) blocks.push(<p key={blocks.length} className="m-0 mb-2">{inline(line)}</p>)
  }
  flush()
  return <>{blocks}</>
}

function inline(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((chunk, i) => (i % 2 ? <strong key={i}>{chunk}</strong> : <Fragment key={i}>{chunk}</Fragment>))
}

/** A small horizontal bar list; the largest value is drawn in the attention colour. */
export function BarChart({ chart }: { chart: Chart }) {
  const max = Math.max(...chart.bars.map((b) => b.value), 0) || 1
  return (
    <figure className="m-0 mb-2 rounded-[10px] border border-rule px-3 py-2.5">
      <figcaption className="mb-2 text-[11.5px] font-semibold tracking-[0.02em] text-pewter uppercase">
        {chart.title}
        {chart.unit ? `, ${chart.unit}` : ''}
      </figcaption>
      {chart.bars.map((bar) => (
        <div key={bar.label} className="tabular my-1 grid grid-cols-[minmax(28px,auto)_1fr_44px] items-center gap-2 text-[12.5px]">
          <span className="truncate">{bar.label}</span>
          <span className="block h-2 rounded-full bg-[#c9d0d6]" style={{ width: `${(bar.value / max) * 100}%`, background: bar.value === max ? 'var(--color-clearing)' : undefined }} />
          <span className="text-right font-semibold">{Number.isInteger(bar.value) ? bar.value : bar.value.toFixed(1)}</span>
        </div>
      ))}
    </figure>
  )
}
