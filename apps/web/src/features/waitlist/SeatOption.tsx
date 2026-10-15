import { Cctv, Hand } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { actionId } from '@/lib/api/board'
import type { QueueParty } from '@/lib/api/types'
import { OverrideReason } from './OverrideReason'
import { useSeating, type HoldTarget } from './useSeating'

/**
 * One way to seat a party: a row with a Hold button. If the API asks for a host override, the
 * reason prompt opens right here instead of an error.
 */
export function SeatOption({
  party,
  target,
  title,
  detail,
  evidence,
  onSelectTable,
}: {
  party: QueueParty
  target: HoldTarget
  title: ReactNode
  detail?: ReactNode
  evidence?: 'camera' | 'manual'
  onSelectTable?: (id: string) => void
}) {
  const { hold, pending, paused, canManage } = useSeating()
  const [override, setOverride] = useState<string | null>(null)
  const busy = pending === actionId({ kind: 'hold-create', tableId: target.table_id, request: { party_id: party.party_id, table_id: target.table_id, party_version: party.version, table_version: target.table_version } })

  return (
    <div className="rounded-xl border border-rule bg-white px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onSelectTable?.(target.table_id)}
          className="min-w-0 flex-1 text-left"
          disabled={!onSelectTable}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-bold">
            {title}
            {evidence ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-wash px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-pewter">
                {evidence === 'camera' ? <Cctv className="size-3" aria-hidden /> : <Hand className="size-3" aria-hidden />}
                {evidence === 'camera' ? 'Camera clear' : 'Staff checked'}
              </span>
            ) : null}
          </span>
          {detail ? <span className="mt-0.5 block text-[13px] leading-snug text-pewter">{detail}</span> : null}
        </button>
        {canManage ? (
          <Button
            tone="primary"
            size="sm"
            pending={busy && !override}
            disabled={paused}
            onClick={() => hold(party, target, { onOverride: setOverride, onDone: () => setOverride(null) })}
          >
            Hold
          </Button>
        ) : null}
      </div>
      {override ? (
        <OverrideReason
          message={override}
          pending={busy}
          onCancel={() => setOverride(null)}
          onSubmit={(reason) => hold(party, target, { reason, onOverride: setOverride, onDone: () => setOverride(null) })}
        />
      ) : null}
    </div>
  )
}
