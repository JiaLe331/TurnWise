import { Armchair, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { actionId, useBoard } from '@/lib/api/board'
import { secondsLeft } from '@/lib/api/seating'
import type { QueueParty, SeatingHold } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { useSeating } from './useSeating'

/** A live hold: who it's for, how long is left, and the host's two ways to end it. */
export function HoldControls({
  hold,
  party,
  className,
}: {
  hold: SeatingHold
  party: QueueParty | undefined
  className?: string
}) {
  const { serverNow } = useBoard()
  const { confirm, release, pending, paused, canManage } = useSeating()
  const left = secondsLeft(hold, serverNow)
  const confirming = pending === actionId({ kind: 'hold', tableId: hold.table_id, holdId: hold.hold_id, request: { action: 'confirm', expected_version: hold.version } })
  const releasing = pending === actionId({ kind: 'hold', tableId: hold.table_id, holdId: hold.hold_id, request: { action: 'cancel', expected_version: hold.version } })

  return (
    <div className={cn('rounded-xl border border-ready/40 bg-ready-tint px-3 py-2.5', className)}>
      <p className="m-0 flex items-center gap-2 text-[14px] font-bold text-ready-deep">
        <Armchair className="size-4" aria-hidden />
        {hold.table_id} held for {party?.queue_code ?? 'a party'}
        <span className="tabular ml-auto flex items-center gap-1 font-semibold" aria-label={`${left} seconds left`}>
          <Timer className="size-3.5" aria-hidden />
          {left} s
        </span>
      </p>
      {hold.override_reason ? (
        <p className="mt-1 mb-0 text-[12.5px] text-ready-deep/80">Host override: {hold.override_reason}</p>
      ) : null}
      {canManage ? (
        <div className="mt-2 flex gap-2">
          <Button tone="ready" size="sm" className="flex-1" pending={confirming} disabled={paused} onClick={() => confirm(hold, party)}>
            Mark seated
          </Button>
          <Button tone="secondary" size="sm" pending={releasing} disabled={paused} onClick={() => release(hold)}>
            Release
          </Button>
        </div>
      ) : null}
    </div>
  )
}
