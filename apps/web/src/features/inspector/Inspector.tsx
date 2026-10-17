import { Accessibility, Ban, Cctv, Clock3, Hand, MapPin, Trees, Users, X } from 'lucide-react'
import { useBoard } from '@/lib/api/board'
import type { TableBoardEntry } from '@/lib/api/types'
import { CameraEvidenceCard, EvidenceChain } from '@/features/evidence/Evidence'
import { ManagerActions } from '@/features/manager/ManagerActions'
import { SeatHere } from '@/features/waitlist/SeatHere'
import { StateChip } from '@/features/table/StateChip'
import { nextSteps } from '@/lib/domain/next-step'
import { elapsedAnchor, openTask } from '@/lib/domain/status'
import { formatAgo, formatSeconds, secondsSince } from '@/lib/domain/time'
import { useIdentity } from '@/lib/identity/dev-identity'
import { StepButton } from './StepButtons'

const ATTRIBUTE_ICON: Record<string, typeof Accessibility> = { accessible: Accessibility, outdoor: Trees }

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const TASK_STATUS: Record<string, string> = {
  unassigned: 'Unassigned',
  claimed: 'Claimed',
  started: 'Cleaning in progress',
}

export function Inspector({ entry, onClose }: { entry: TableBoardEntry; onClose?: () => void }) {
  const { serverNow, queuePosition } = useBoard()
  const { actor } = useIdentity()
  const { table, session } = entry
  const id = table.table_id
  const anchor = elapsedAnchor(entry)
  const task = openTask(entry)
  const steps = nextSteps(entry, actor)
  const position = queuePosition.get(id)

  return (
    <article aria-label={`Table ${id}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-rule px-5 pt-4.5 pb-4">
        <div className="flex items-start gap-3.5">
          <h2 className="m-0 font-serif text-[52px] leading-none font-normal">{id}</h2>
          <div className="flex flex-1 flex-wrap items-center gap-1.5 pt-1.5">
            <StateChip state={session.operational_state} />
            {table.blocked ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-blocked-tint px-2 py-1.5 text-[13px] font-bold text-blocked">
                <Ban className="size-3.5" aria-hidden />
                Blocked
              </span>
            ) : null}
            {session.manual ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-wash px-2 py-1.5 text-[13px] font-bold">
                <Hand className="size-3.5" aria-hidden />
                Manual
              </span>
            ) : null}
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-pewter hover:bg-wash"
              aria-label="Close table details"
            >
              <X className="size-5" />
            </button>
          ) : null}
        </div>
        {anchor ? (
          <p className="mt-2.5 mb-0 flex items-center gap-1.5 text-[14px] font-medium text-pewter">
            <Clock3 className="size-4" aria-hidden />
            <span className="tabular">{formatSeconds(secondsSince(anchor.at, serverNow))}</span> {anchor.phrase}
          </p>
        ) : null}
        <p className="mt-1.5 mb-0 flex flex-wrap gap-x-3.5 gap-y-1 text-[14px] font-medium text-pewter">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" aria-hidden />
            {table.capacity} seats
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" aria-hidden />
            {table.zone}
          </span>
          {table.attributes.map((attribute) => {
            const Icon = ATTRIBUTE_ICON[attribute]
            return (
              <span key={attribute} className="flex items-center gap-1.5">
                {Icon ? <Icon className="size-4" aria-hidden /> : null}
                {titleCase(attribute)}
              </span>
            )
          })}
        </p>
      </header>

      {task ? (
        <section className="border-b border-rule px-5 py-4" aria-labelledby="task-heading">
          <h3 id="task-heading" className="m-0 mb-2.5 flex items-center text-[14px] font-bold">
            Clearing task
            {position ? (
              <span className="ml-auto text-[12.5px] font-medium text-pewter">
                {position === 1 ? 'First' : `#${position}`} in clearing order
              </span>
            ) : null}
          </h3>
          <p className="m-0 text-[15px] font-semibold">
            {TASK_STATUS[task.status]}
            {task.owner_id ? <span className="font-medium text-pewter"> by {task.owner_id}</span> : null}
          </p>
          <p className="mt-1 mb-3.5 text-[13.5px] font-medium text-pewter">
            {task.priority_reason}. Created {formatAgo(secondsSince(task.created_at, serverNow))}.
          </p>
          <ActionArea steps={steps} />
        </section>
      ) : steps.primary || steps.secondary.length || steps.note ? (
        <section className="border-b border-rule px-5 py-4" aria-label="Actions">
          <ActionArea steps={steps} />
        </section>
      ) : null}

      <SeatHere entry={entry} />

      <ManagerActions entry={entry} actor={actor} />

      <section className="border-b border-rule px-5 py-4" aria-labelledby="evidence-heading">
        <h3 id="evidence-heading" className="m-0 mb-3 text-[14px] font-bold">
          How {id} got here
        </h3>
        <EvidenceChain entry={entry} serverNow={serverNow} />
      </section>

      <section className="px-5 py-4" aria-labelledby="camera-heading">
        <h3 id="camera-heading" className="m-0 mb-3 flex items-center gap-2 text-[14px] font-bold">
          <Cctv className="size-4" aria-hidden />
          Camera evidence
        </h3>
        <CameraEvidenceCard entry={entry} />
      </section>
    </article>
  )
}

function ActionArea({ steps }: { steps: ReturnType<typeof nextSteps> }) {
  return (
    <div className="flex flex-col gap-2">
      {steps.primary ? <StepButton step={steps.primary} block /> : null}
      {steps.secondary.length ? (
        <div className="flex flex-wrap gap-2">
          {steps.secondary.map((step) => (
            <StepButton key={step.label} step={step} size="md" className="min-w-fit flex-1" />
          ))}
        </div>
      ) : null}
      {steps.note ? <p className="m-0 text-[13.5px] leading-relaxed text-pewter">{steps.note}</p> : null}
    </div>
  )
}
