import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { StepButton } from '@/features/inspector/StepButtons'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { nextSteps } from '@/lib/domain/next-step'
import { elapsedAnchor, openTask, STATE } from '@/lib/domain/status'
import { formatMinutes, minutesSince } from '@/lib/domain/time'
import { useIdentity } from '@/lib/identity/dev-identity'

interface QueueCardsProps {
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Phone-first clearing queue: one card per task, each with one large next step. */
export function QueueCards({ selectedId, onSelect }: QueueCardsProps) {
  const { board, entries, serverNow, freshness } = useBoard()
  const { actor } = useIdentity()
  const [mineOnly, setMineOnly] = useState(false)
  const queue = board?.clearing_queue ?? []
  const mine = queue.filter((e) => openTask(e)?.owner_id === actor?.id)
  const shown = mineOnly ? mine : queue
  const checks = entries.filter((e) => e.session.operational_state === 'departure_review')

  if (freshness === 'loading') {
    return (
      <div className="space-y-2.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[14px] bg-wash" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="m-0 text-[18px] font-bold">Clearing queue</h2>
        <div role="radiogroup" aria-label="Show tasks" className="flex rounded-[9px] bg-wash p-[3px]">
          {[
            { on: false, label: `All ${queue.length}` },
            { on: true, label: `Mine ${mine.length}` },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={mineOnly === option.on}
              onClick={() => setMineOnly(option.on)}
              className={cn(
                'rounded-[7px] px-2.5 py-1.5 text-[13px] font-semibold text-pewter',
                mineOnly === option.on && 'bg-white text-ink shadow-sm',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-rule bg-white p-4 text-[14px] text-pewter">
          <Sparkles className="size-5 text-ready" aria-hidden />
          {mineOnly ? 'You have no clearing tasks.' : 'No tables waiting to be cleared.'}
        </div>
      ) : (
        <ol className="m-0 list-none space-y-2.5 p-0">
          {shown.map((entry) => (
            <li key={entry.table.table_id}>
              <QueueCard
                entry={entry}
                order={queue.indexOf(entry) + 1}
                serverNow={serverNow}
                selected={entry.table.table_id === selectedId}
                onSelect={onSelect}
                actorId={actor?.id}
              />
            </li>
          ))}
        </ol>
      )}

      {checks.length ? (
        <>
          <h2 className="mt-5 mb-2.5 text-[13px] font-semibold text-pewter">Departure checks</h2>
          <ul className="m-0 list-none space-y-2.5 p-0">
            {checks.map((entry) => (
              <li key={entry.table.table_id}>
                <QueueCard
                  entry={entry}
                  serverNow={serverNow}
                  selected={entry.table.table_id === selectedId}
                  onSelect={onSelect}
                  actorId={actor?.id}
                  description="Has the party left? Confirming releases the table and creates a clearing task."
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

interface CardProps {
  entry: TableBoardEntry
  order?: number
  serverNow: number
  selected: boolean
  onSelect: (id: string) => void
  actorId?: string
  description?: string
}

function QueueCard({ entry, order, serverNow, selected, onSelect, actorId, description }: CardProps) {
  const { actor } = useIdentity()
  const { table, session } = entry
  const s = STATE[session.operational_state]
  const Icon = s.icon
  const anchor = elapsedAnchor(entry)
  const task = openTask(entry)
  const yours = task?.owner_id && task.owner_id === actorId
  const steps = nextSteps(entry, actor)
  const owner = task?.owner_id ? (yours ? 'you' : task.owner_id) : 'unassigned'
  const sub =
    description ??
    [table.zone, `${table.capacity} seats`, ...table.attributes.map((a) => a[0].toUpperCase() + a.slice(1)), owner].join(' · ')

  return (
    <div
      className={cn(
        'rounded-[14px] border border-rule bg-white p-3.5',
        selected && 'border-2 border-ink p-[13px]',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(table.table_id)}
        className="flex w-full items-center gap-2.5 text-left"
        aria-label={`Show ${table.table_id} on the floor`}
      >
        {order ? (
          <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">
            {order}
          </span>
        ) : null}
        <span className="font-serif text-[28px] leading-none">{table.table_id}</span>
        <span className="flex items-center gap-1.5 text-[15px] font-bold">
          <Icon className="size-[17px]" style={{ color: s.solid }} aria-hidden />
          {s.label}
        </span>
        {yours ? (
          <span className="rounded-md bg-cleaning-tint px-1.5 py-0.5 text-[11.5px] font-bold text-cleaning-deep">You</span>
        ) : null}
        <span className="tabular ml-auto text-[14px] font-semibold text-pewter">
          {anchor ? formatMinutes(minutesSince(anchor.at, serverNow)) : ''}
        </span>
      </button>
      <p className="mt-1.5 mb-3 text-[13.5px] leading-snug text-pewter">{sub}</p>
      {steps.primary ? <StepButton step={steps.primary} size="xl" block /> : null}
      {steps.secondary.length ? (
        <div className={cn('flex gap-2', steps.primary && 'mt-2')}>
          {steps.secondary.map((step) => (
            <StepButton key={step.label} step={step} size="lg" className="flex-1" />
          ))}
        </div>
      ) : null}
      {steps.note ? <p className="m-0 text-[13.5px] text-pewter">{steps.note}</p> : null}
    </div>
  )
}
