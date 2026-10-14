import { Ban, Hand, Undo2, XCircle } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { actionId, useActions } from '@/lib/api/board'
import type { OperationalState, TableBoardEntry } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { can } from '@/lib/domain/permissions'
import { openTask, STATE } from '@/lib/domain/status'
import type { Persona } from '@/lib/identity/personas'

/** States the backend accepts as override targets (tables.py OVERRIDE_TARGETS). */
const OVERRIDE_TARGETS: OperationalState[] = ['occupied', 'departure_review', 'needs_clearing', 'ready']

export function ManagerActions({ entry, actor }: { entry: TableBoardEntry; actor: Persona | null }) {
  const role = actor?.role
  const { run, pending, paused } = useActions()
  const { table, session } = entry
  const id = table.table_id
  const task = openTask(entry)

  const canOverride = can(role, 'override_state')
  const canBlock = can(role, table.blocked ? 'unblock' : 'block')
  const canRelease = session.manual && can(role, 'release_override')
  const canCancel = task && can(role, 'cancel_task')
  if (!canOverride && !canBlock && !canRelease && !canCancel) return null

  return (
    <section className="border-b border-rule px-5 py-4" aria-labelledby="manager-actions">
      <h3 id="manager-actions" className="m-0 mb-3 text-[14px] font-bold">
        Corrections
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {canOverride ? <OverrideDialog entry={entry} /> : null}
        {canRelease ? (
          <Button
            size="md"
            disabled={paused}
            pending={pending === actionId({ tableId: id, request: { action: 'release_override' } })}
            onClick={() =>
              run(
                { kind: 'table', tableId: id, request: { action: 'release_override', expected_version: session.state_version } },
                { success: `Override released on ${id}` },
              )
            }
          >
            <Undo2 aria-hidden />
            Release override
          </Button>
        ) : null}
        {canBlock ? <BlockDialog entry={entry} /> : null}
        {canCancel && task ? <ReasonDialog
          trigger={<><XCircle aria-hidden />Cancel task</>}
          title={`Cancel the clearing task on ${id}?`}
          description="The table stays in its current state without a clearing task. Use this when the task was created by mistake."
          confirmLabel="Cancel task"
          required
          onConfirm={(reason, done) =>
            run(
              {
                kind: 'task',
                tableId: id,
                taskId: task.task_id,
                request: { action: 'cancel', reason, expected_version: session.state_version },
              },
              { success: `Clearing task cancelled on ${id}`, onSuccess: done },
            )
          }
        /> : null}
      </div>
    </section>
  )
}

function OverrideDialog({ entry }: { entry: TableBoardEntry }) {
  const { run, busy, paused } = useActions()
  const { table, session } = entry
  const id = table.table_id
  const targets = OVERRIDE_TARGETS.filter((s) => s !== session.operational_state)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<OperationalState | null>(null)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const reasonId = useId()
  const hasTask = Boolean(openTask(entry))

  const submit = () => {
    setTouched(true)
    if (!target || !reason.trim()) return
    run(
      {
        kind: 'table',
        tableId: id,
        request: { action: 'override_state', target_state: target, reason: reason.trim(), expected_version: session.state_version },
      },
      {
        success: `${id} set to ${STATE[target].label.toLowerCase()}`,
        onSuccess: () => {
          setOpen(false)
          setTarget(null)
          setReason('')
          setTouched(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="md" disabled={paused} onClick={() => setOpen(true)}>
        <Hand aria-hidden />
        Override state
      </Button>
      <DialogContent
        title={`Override ${id}`}
        description={
          <>
            Sets the state by hand. The table shows a Manual marker until someone releases it.
            {hasTask ? ' The open clearing task will be cancelled.' : ''}
          </>
        }
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-[14px] font-bold">New state</legend>
          <div className="grid grid-cols-2 gap-2">
            {targets.map((state) => {
              const s = STATE[state]
              const Icon = s.icon
              return (
                <label
                  key={state}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-2 rounded-[10px] border border-rule px-3 text-[14px] font-semibold has-[:checked]:border-2 has-[:checked]:border-ink has-[:focus-visible]:outline-2',
                  )}
                  style={target === state ? { background: s.tint } : undefined}
                >
                  <input
                    type="radio"
                    name="override-target"
                    className="sr-only"
                    checked={target === state}
                    onChange={() => setTarget(state)}
                  />
                  <Icon className="size-4" style={{ color: s.solid }} aria-hidden />
                  {s.label}
                </label>
              )
            })}
          </div>
          {touched && !target ? <p className="mt-1.5 mb-0 text-[13px] text-clearing-deep">Choose a state.</p> : null}
        </fieldset>
        <ReasonField id={reasonId} value={reason} onChange={setReason} invalid={touched && !reason.trim()} />
        <div className="flex gap-2">
          <Button tone="primary" size="lg" className="flex-1" pending={busy} onClick={submit}>
            Override state
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BlockDialog({ entry }: { entry: TableBoardEntry }) {
  const { run } = useActions()
  const id = entry.table.table_id
  const blocked = entry.table.blocked
  return (
    <ReasonDialog
      trigger={<><Ban aria-hidden />{blocked ? 'Unblock table' : 'Block table'}</>}
      tone={blocked ? 'secondary' : 'danger'}
      title={blocked ? `Unblock ${id}?` : `Block ${id}?`}
      description={
        blocked
          ? 'The table becomes available again in its current state.'
          : 'A blocked table stays out of seating whatever its state. Its state and any clearing task are kept.'
      }
      confirmLabel={blocked ? 'Unblock table' : 'Block table'}
      required={!blocked}
      onConfirm={(reason, done) =>
        run(
          { kind: 'table', tableId: id, request: { action: blocked ? 'unblock' : 'block', reason: reason || null } },
          { success: blocked ? `${id} unblocked` : `${id} blocked`, onSuccess: done },
        )
      }
    />
  )
}

function ReasonField({
  id,
  value,
  onChange,
  invalid,
  optional,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  invalid: boolean
  optional?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-bold">
        Reason{optional ? <span className="font-medium text-pewter"> (optional)</span> : null}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="w-full resize-none rounded-[10px] border border-[#c9d0ca] px-3 py-2.5 text-[15px] outline-none focus:border-ink aria-[invalid]:border-clearing"
        placeholder="Recorded with the change"
      />
      {invalid ? (
        <p id={`${id}-error`} className="mt-1 mb-0 text-[13px] text-clearing-deep">
          Add a reason before saving.
        </p>
      ) : null}
    </div>
  )
}

function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  required,
  tone = 'secondary',
  onConfirm,
}: {
  trigger: ReactNode
  title: string
  description: string
  confirmLabel: string
  required: boolean
  tone?: 'secondary' | 'danger'
  onConfirm: (reason: string, done: () => void) => void
}) {
  const { busy, paused } = useActions()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const id = useId()
  const invalid = required && touched && !reason.trim()

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setReason(''); setTouched(false) } }}>
      <Button size="md" tone={tone} disabled={paused} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <DialogContent title={title} description={description}>
        <ReasonField id={id} value={reason} onChange={setReason} invalid={invalid} optional={!required} />
        <Button
          tone="primary"
          size="lg"
          pending={busy}
          onClick={() => {
            setTouched(true)
            if (required && !reason.trim()) return
            onConfirm(reason.trim(), () => {
              setOpen(false)
              setReason('')
              setTouched(false)
            })
          }}
        >
          {confirmLabel}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
