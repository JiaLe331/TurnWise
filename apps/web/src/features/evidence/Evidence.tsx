import { CameraOff, Cctv, Sparkles, UserCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { STATE } from '@/lib/domain/status'
import { formatAgo, secondsSince } from '@/lib/domain/time'

interface StaffStep {
  title: string
  at: string | null
}

/**
 * The most recent human-recorded step that explains the current state. Who did it needs the audit
 * endpoint, which doesn't exist yet, so only the time is shown.
 */
function staffStep(entry: TableBoardEntry): StaffStep | null {
  const { session, task } = entry
  switch (session.operational_state) {
    case 'needs_clearing':
      return { title: 'Departure recorded', at: session.departed_at }
    case 'cleaning':
      return { title: `Cleaning started${task?.owner_id ? ` by ${task.owner_id}` : ''}`, at: task?.started_at ?? null }
    case 'ready':
      return { title: 'Ready recorded', at: session.ready_at }
    case 'occupied':
      return session.seated_at ? { title: 'Party seated', at: session.seated_at } : null
    case 'departure_review':
      return { title: 'Departure check requested', at: null }
  }
}

function Node({
  icon,
  title,
  detail,
  badge,
  variant,
  accent,
}: {
  icon: ReactNode
  title: string
  detail: string
  badge?: string
  variant: 'unavailable' | 'person' | 'state'
  accent?: { solid: string; tint: string }
}) {
  return (
    <li className="relative grid grid-cols-[32px_1fr] items-start gap-2.5 text-[13px] leading-snug text-pewter">
      <span
        className={cn(
          'grid size-8 place-items-center rounded-[9px] border border-rule bg-white [&_svg]:size-4',
          variant === 'unavailable' && 'hatch border-dashed',
        )}
        style={variant === 'state' && accent ? { background: accent.tint, borderColor: accent.solid, color: accent.solid } : undefined}
        aria-hidden
      >
        {icon}
      </span>
      <span>
        <b className="block text-[13.5px] text-ink">
          {title}
          {badge ? (
            <span className="ml-1.5 inline-block rounded-[5px] bg-wash px-1.5 align-[1px] text-[11px] font-semibold text-pewter">
              {badge}
            </span>
          ) : null}
        </b>
        {detail}
      </span>
    </li>
  )
}

/** How the table reached its current state: camera evidence, then people, then the state itself. */
export function EvidenceChain({ entry, serverNow }: { entry: TableBoardEntry; serverNow: number }) {
  const state = STATE[entry.session.operational_state]
  const StateIcon = state.icon
  const step = staffStep(entry)
  const hasCamera = Boolean(entry.table.camera_id)
  const ev = entry.evidence
  const check = ev?.table_check

  return (
    <div>
      <ol className="relative m-0 flex list-none flex-col gap-2.5 p-0 before:absolute before:top-4 before:bottom-4 before:left-[15px] before:border-l-2 before:border-dotted before:border-[#c3cbc5]">
        {ev?.last_observed_at ? (
          <Node
            variant="person"
            icon={<Cctv />}
            title={`Camera: ${ev.visual_status ?? 'no reading'}${ev.stale ? ' (stale)' : ''}`}
            badge={ev.source_mode === 'replay' ? 'Recorded replay' : 'Camera'}
            detail={
              ev.review_source === 'observation'
                ? 'No seated guests for 30 s, so the camera asked staff to check'
                : `Seen ${formatAgo(secondsSince(ev.last_observed_at, serverNow))}${ev.object_flags.length ? ` · ${ev.object_flags.join(', ')}` : ''}`
            }
          />
        ) : (
          <Node
            variant="unavailable"
            icon={hasCamera ? <Cctv /> : <CameraOff />}
            title="Camera observation"
            detail={hasCamera ? 'Camera assigned; no observation received yet.' : 'No camera mapped to this table'}
          />
        )}
        {check ? (
          <Node
            variant="person"
            icon={<Sparkles />}
            title={`Gemini: ${check.state.replace(/_/g, ' ')}${check.items.length ? ` (${check.items.join(', ')})` : ''}`}
            badge={check.model}
            detail={check.reason}
          />
        ) : null}
        {step ? (
          <Node
            variant="person"
            icon={<UserCheck />}
            title={step.title}
            badge="Staff"
            detail={step.at ? formatAgo(secondsSince(step.at, serverNow)) : 'Waiting for someone to check the table'}
          />
        ) : null}
        <Node
          variant="state"
          accent={state}
          icon={<StateIcon />}
          title={state.label}
          detail={entry.session.manual ? 'Current table state, set by a manager override' : 'Current table state'}
        />
      </ol>
      <p className="mt-3 mb-0 text-[12.5px] leading-relaxed text-pewter">
        Cameras can only suggest a check. Staff confirm every departure and every ready table.
      </p>
    </div>
  )
}

/** Where masked camera evidence will appear. Today it states plainly that there is none. */
export function CameraEvidenceCard({ entry }: { entry: TableBoardEntry }) {
  const id = entry.table.table_id
  const hasCamera = Boolean(entry.table.camera_id)
  const ev = entry.evidence
  if (ev?.last_observed_at) {
    return (
      <div className="rounded-[10px] border border-rule bg-wash p-3 text-[13px]">
        <b className="mb-1 flex items-center gap-1.5 text-[14px]">
          <Cctv className="size-4" aria-hidden />
          {ev.camera_id}: {ev.visual_status ?? 'no reading'}
          {ev.stale ? <span className="text-clearing-deep">· stale</span> : null}
        </b>
        <p className="m-0 text-pewter">
          {ev.source_mode === 'replay' ? 'Recorded replay' : 'Live'} · {ev.model_version}
          {ev.uncertainty_reasons.length ? ` · ${ev.uncertainty_reasons.join(', ')}` : ''}
        </p>
        {ev.table_check ? (
          <p className="m-0 mt-1.5">
            <Sparkles className="mr-1 inline size-3.5 text-review" aria-hidden />
            Gemini ({ev.table_check.model}): {ev.table_check.state.replace(/_/g, ' ')}. {ev.table_check.reason}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <div className="hatch grid aspect-video place-items-center rounded-[10px] border border-dashed border-[#c5ccc6] p-4 text-center">
      <div>
        <CameraOff className="mx-auto size-[22px] text-pewter" aria-hidden />
        <b className="mt-2 mb-1 block text-[14px]">
          {hasCamera ? `Camera assigned to ${id}` : `No camera assigned to ${id}`}
        </b>
        <p className="m-0 max-w-[280px] text-[13px] leading-relaxed text-pewter">
          {hasCamera
            ? 'Observations will appear here when the observation service is connected.'
            : 'Masked table-region views and observations appear here once a camera is mapped. Until then, staff manage this table by hand.'}
        </p>
      </div>
    </div>
  )
}
