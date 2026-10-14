import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Ban, Brush, ChevronLeft, CircleCheck, Route, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useBoard } from '@/lib/api/board'
import { ApiError, request, type Actor } from '@/lib/api/client'
import type { OperationalState, QueueParty, SeatingResult, TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { STATE } from '@/lib/domain/status'
import { MIXKIT_LAYOUT } from './mixkitFloor'

// Plan coordinates come from the same floor plan as the 3D view (built from the footage).
const B = MIXKIT_LAYOUT.bounds
const W = B.maxX - B.minX
const D = B.maxZ - B.minZ
const pct = (x: number, z: number) => ({ left: `${((x - B.minX) / W) * 100}%`, top: `${((z - B.minZ) / D) * 100}%` })

const STAFF: Actor = { id: 'staff-ana', role: 'floor_staff' }
const HOST: Actor = { id: 'host-1', role: 'host' }
const MANAGER: Actor = { id: 'manager-1', role: 'manager' }

type Bucket = 'open' | 'seated' | 'clearing' | 'blocked'
const BUCKET_STATES: Record<Exclude<Bucket, 'blocked'>, OperationalState[]> = {
  open: ['ready'],
  seated: ['occupied', 'departure_review'],
  clearing: ['needs_clearing', 'cleaning'],
}
const LEGEND: { bucket: Bucket; label: string; color: string }[] = [
  { bucket: 'open', label: 'Open', color: 'var(--color-ready)' },
  { bucket: 'seated', label: 'Seated', color: 'var(--color-occupied)' },
  { bucket: 'clearing', label: 'Clearing', color: 'var(--color-clearing)' },
  { bucket: 'blocked', label: 'Blocked', color: 'var(--color-blocked)' },
]

function bucketOf(e: TableBoardEntry): Bucket {
  if (e.table.blocked) return 'blocked'
  const s = e.session.operational_state
  return (Object.keys(BUCKET_STATES) as Exclude<Bucket, 'blocked'>[]).find((b) => BUCKET_STATES[b].includes(s)) ?? 'seated'
}

const key = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

function tableAction(id: string, actor: Actor, action: string, version: number, reason?: string) {
  return request(`/tables/${id}/actions`, {
    method: 'POST',
    body: { action, expected_version: version, reason },
    actor,
    idempotencyKey: key(),
  })
}

function taskAction(taskId: string, actor: Actor, action: string) {
  return request(`/tasks/${taskId}/actions`, { method: 'POST', body: { action }, actor, idempotencyKey: key() })
}

export function HostFloorPlan({
  selectedId,
  onSelect,
  simNow,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
  simNow: string | null
}) {
  const { entries, byId } = useBoard()
  const counts = Object.fromEntries(LEGEND.map((l) => [l.bucket, entries.filter((e) => bucketOf(e) === l.bucket).length]))
  const selected = selectedId ? byId.get(selectedId) : undefined
  const time = simNow ? new Date(simNow).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '--:--'

  return (
    <div className="flex h-full flex-col gap-2 p-3 pb-12">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.12em] text-ink uppercase">
          <span className="size-2.5 animate-pulse rounded-full bg-ready" aria-hidden />
          Live host floor
        </span>
        <span className="font-mono text-[13px] text-pewter" aria-label="Shift clock">{time}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,0.8fr)_1.2fr] gap-2">
        <TablePanel entry={selected} onClose={() => onSelect(null)} />
        <div className="relative min-h-[260px] overflow-hidden rounded-xl border border-rule bg-[#f6f5f0]" aria-label="Floor plan">
          <Room />
          {entries.map((e) => (
            <Tile key={e.table.table_id} entry={e} selected={e.table.table_id === selectedId} onSelect={onSelect} />
          ))}
          <div className="absolute right-2 bottom-2 flex flex-wrap gap-x-3 gap-y-1 rounded-full bg-white/95 px-3 py-1 text-[12px] shadow-sm">
            {LEGEND.map((l) => (
              <span key={l.bucket} className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
                <b>{counts[l.bucket]}</b> <span className="text-pewter">{l.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Room() {
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="absolute inset-x-0 top-0 flex h-[5%] items-center justify-center bg-[#dce4e7] text-[10px] tracking-widest text-pewter uppercase">
        Windows · street
      </div>
      {/* Bar and stools along the left wall */}
      <div className="absolute rounded-md bg-[#2b3640]/85" style={{ left: '3%', width: '14%', top: '11%', height: '66%' }}>
        <span className="absolute inset-0 grid place-items-center text-[10px] tracking-widest text-white/80 uppercase [writing-mode:vertical-rl]">
          Bar
        </span>
      </div>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className="absolute size-3 rounded-full border border-[#2b3640]/50 bg-white" style={{ left: '20%', top: `${14 + i * 9.5}%` }} />
      ))}
      {/* Banquette along the right wall */}
      <div className="absolute rounded-md bg-[#e2ded6]" style={{ right: '2%', width: '11%', top: '6%', height: '86%' }} />
      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] tracking-widest text-pewter uppercase">Entrance</span>
    </div>
  )
}

function Tile({ entry, selected, onSelect }: { entry: TableBoardEntry; selected: boolean; onSelect: (id: string) => void }) {
  const placed = MIXKIT_LAYOUT.tables.get(entry.table.table_id)
  if (!placed) return null
  const state = STATE[entry.session.operational_state]
  const w = (placed.shape.width / W) * 100
  const h = (placed.shape.depth / D) * 100
  const at = pct(placed.x - placed.shape.width / 2, placed.z - placed.shape.depth / 2)
  const ev = entry.evidence
  const flagged = ev?.table_check?.state === 'leftovers' || ev?.visual_status === 'occupied'
  // The board waits for staff (and the 30 s rule) before releasing a party; show when the camera
  // already sees the seats empty so the plan never contradicts the footage without saying why.
  const looksEmpty =
    !ev?.stale && ev?.visual_status === 'vacant' && ['occupied', 'departure_review'].includes(entry.session.operational_state)
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.table.table_id)}
      aria-pressed={selected}
      aria-label={`${entry.table.table_id}, ${state.label}, ${entry.table.capacity} seats`}
      className={cn(
        'absolute grid place-items-center rounded-lg border-2 text-center transition-colors',
        selected ? 'ring-2 ring-ink ring-offset-2' : '',
        looksEmpty && 'border-dashed',
      )}
      style={{ ...at, width: `${w}%`, height: `${h}%`, minWidth: 44, minHeight: 40, background: state.tint, borderColor: state.solid }}
    >
      <span className="leading-tight">
        <b className="block text-[14px] text-ink">{entry.table.table_id}</b>
        <span className="block text-[10px] text-pewter">{entry.table.capacity}p</span>
      </span>
      <span
        className="absolute -top-1.5 -right-1.5 size-3.5 rounded-full border-2 border-white"
        style={{ background: entry.table.blocked ? 'var(--color-blocked)' : state.solid }}
        aria-hidden
      />
      {looksEmpty ? (
        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-dashed border-review bg-white px-1.5 text-[9px] font-bold whitespace-nowrap text-review-deep">
          looks empty
        </span>
      ) : null}
      {flagged && entry.session.operational_state === 'ready' ? (
        <span className="absolute -bottom-1.5 -right-1.5 size-3 rounded-full border-2 border-white bg-review" title="Camera or Gemini needs a check" />
      ) : null}
    </button>
  )
}

function TablePanel({ entry, onClose }: { entry: TableBoardEntry | undefined; onClose: () => void }) {
  const { board, refetch } = useBoard()
  const queryClient = useQueryClient()
  const [size, setSize] = useState(2)
  const [busy, setBusy] = useState<string | null>(null)
  if (!entry) {
    return (
      <div className="grid place-items-center rounded-xl border border-rule bg-white p-4 text-center text-[13px] text-pewter">
        Tap a table on the plan to seat, clear or block it.
      </div>
    )
  }
  const id = entry.table.table_id
  const s = entry.session.operational_state
  const task = entry.task && ['unassigned', 'claimed', 'started'].includes(entry.task.status) ? entry.task : null
  const waiting = (board?.waitlist ?? []).filter((p) => p.status === 'waiting')
  const nextUp = waiting.find((p) => p.size === size) ?? waiting.find((p) => p.size <= entry.table.capacity)

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label)
    try {
      await fn()
      toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.')
    } finally {
      setBusy(null)
      refetch()
      void queryClient.invalidateQueries({ queryKey: ['recommendation'] })
    }
  }

  const reopen = () =>
    run('open', async () => {
      let version = entry.session.state_version
      if (task?.status === 'unassigned') await taskAction(task.task_id, STAFF, 'claim')
      if (task && task.status !== 'started') {
        const started = (await taskAction(task.task_id, STAFF, 'start')) as TableBoardEntry
        version = started.session.state_version
      }
      await tableAction(id, STAFF, 'mark_ready', version)
    }, `${id} is open`)

  const clear = () => run('clear', () => tableAction(id, STAFF, 'confirm_departure', entry.session.state_version), `${id} sent to clearing`)

  const block = () =>
    run(
      'block',
      () => tableAction(id, MANAGER, entry.table.blocked ? 'unblock' : 'block', entry.session.state_version, 'Blocked from the host floor'),
      entry.table.blocked ? `${id} unblocked` : `${id} blocked`,
    )

  const seat = () =>
    run(
      'seat',
      async () => {
        let party: QueueParty | undefined = nextUp
        if (!party) {
          party = await request<QueueParty>('/parties', {
            method: 'POST',
            body: { queue_code: `Q${Math.floor(Math.random() * 900 + 100)}`, size },
            actor: HOST,
            idempotencyKey: key(),
          })
        }
        const body = { party_id: party.party_id, table_id: id, party_version: party.version, table_version: entry.session.state_version }
        let held: SeatingResult
        try {
          held = await request<SeatingResult>('/seating-holds', { method: 'POST', body, actor: HOST, idempotencyKey: key() })
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'override_reason_required') throw error
          held = await request<SeatingResult>('/seating-holds', {
            method: 'POST',
            body: { ...body, override_reason: 'Quick-seat at the host stand after a visual check' },
            actor: HOST,
            idempotencyKey: key(),
          })
        }
        await request(`/seating-holds/${held.hold.hold_id}/actions`, {
          method: 'POST',
          body: { action: 'confirm', expected_version: held.hold.version },
          actor: HOST,
          idempotencyKey: key(),
        })
      },
      `Seated at ${id}`,
    )

  const chips = [
    { key: 'open', label: 'Open', icon: CircleCheck, active: s === 'ready', enabled: s === 'needs_clearing' || s === 'cleaning', onClick: reopen },
    { key: 'seated', label: 'Seated', icon: Users, active: s === 'occupied' || s === 'departure_review', enabled: false, onClick: () => undefined },
    { key: 'clear', label: 'Clearing', icon: Brush, active: s === 'needs_clearing' || s === 'cleaning', enabled: s === 'occupied' || s === 'departure_review', onClick: clear },
    { key: 'block', label: entry.table.blocked ? 'Unblock' : 'Block', icon: Ban, active: entry.table.blocked, enabled: true, onClick: block },
  ]

  return (
    <div className="flex flex-col gap-2.5 overflow-y-auto rounded-xl border border-rule bg-white p-3">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-md hover:bg-wash" aria-label="Close table">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <b className="text-[16px]">Table {id}</b>
        <span className="rounded-md bg-wash px-1.5 py-0.5 text-[11px] font-semibold text-pewter">{STATE[s].label}</span>
      </div>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Table state">
        {chips.map(({ key: k, label, icon: Icon, active, enabled, onClick }) => (
          <button
            key={k}
            type="button"
            onClick={onClick}
            disabled={!enabled || busy !== null}
            aria-pressed={active}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed',
              active ? 'border-ready bg-ready-tint text-ready-deep' : 'border-rule text-pewter',
              enabled && !active && 'hover:border-ink hover:text-ink',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {s === 'ready' && !entry.table.blocked ? (
        <div className="space-y-2">
          <b className="block text-[13px]">Quick-seat party</b>
          <p className="m-0 flex items-center gap-1 rounded-md bg-wash px-2 py-1 text-[12px] text-pewter">
            <Route className="size-3.5" aria-hidden />
            {nextUp ? `Auto route: next up ${nextUp.queue_code} (${nextUp.size})` : 'New walk-in'}
          </p>
          <div className="grid grid-cols-5 gap-1" role="group" aria-label="Party size">
            {[1, 2, 3, 4, 6].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSize(n)}
                aria-pressed={size === n}
                disabled={n > entry.table.capacity}
                className={cn(
                  'h-9 rounded-lg border text-[15px] font-bold disabled:opacity-30',
                  size === n ? 'border-ink bg-ink text-white' : 'border-rule bg-white',
                )}
              >
                {n === 6 ? '5+' : n}
              </button>
            ))}
          </div>
          <Button tone="primary" size="sm" block pending={busy === 'seat'} onClick={seat}>
            Seat {nextUp ? nextUp.queue_code : size} <ArrowRight aria-hidden />
          </Button>
        </div>
      ) : (
        <p className="m-0 text-[12px] text-pewter">
          {s === 'departure_review'
            ? 'The camera thinks this party left. Mark Clearing once staff confirm.'
            : s === 'occupied'
              ? 'Party seated. Mark Clearing when they leave.'
              : 'Being cleared. Mark Open when the reset is done.'}
        </p>
      )}
    </div>
  )
}
