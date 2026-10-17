import { Clock3, MoreHorizontal } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown'
import { useBoard } from '@/lib/api/board'
import type { PartyAction, QueueParty, SeatingHold } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { formatSeconds, secondsSince } from '@/lib/domain/time'
import { HoldControls } from './HoldControls'
import { useSeating } from './useSeating'

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function PartyRow({
  party,
  hold,
  selected,
  onSelect,
}: {
  party: QueueParty
  hold: SeatingHold | undefined
  selected: boolean
  onSelect: (id: string | null) => void
}) {
  const { serverNow } = useBoard()
  const { canManage } = useSeating()
  const [dialog, setDialog] = useState<PartyAction | null>(null)

  return (
    <li>
      <div
        className={cn(
          'rounded-xl border bg-white transition-colors',
          selected ? 'border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-rule',
        )}
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <button
            type="button"
            onClick={() => onSelect(selected ? null : party.party_id)}
            aria-pressed={selected}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <span className="font-serif text-[20px] leading-none">{party.queue_code}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Party of {party.size}</span>
              {party.requirements.length ? (
                <span className="block truncate text-[12.5px] text-pewter">
                  Needs {party.requirements.map(titleCase).join(', ')}
                </span>
              ) : null}
            </span>
            {hold ? null : (
              <span className="tabular flex items-center gap-1 text-[13px] font-semibold text-pewter" title="Waiting time">
                <Clock3 className="size-3.5" aria-hidden />
                {formatSeconds(secondsSince(party.arrival_at, serverNow))}
              </span>
            )}
          </button>
          {canManage ? (
            <Dropdown>
              <DropdownTrigger
                className="-mr-1 grid size-8 place-items-center rounded-lg text-pewter hover:bg-wash"
                aria-label={`More actions for ${party.queue_code}`}
              >
                <MoreHorizontal className="size-4" />
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem disabled={Boolean(hold)} onSelect={() => setDialog('update')}>
                  Change party size
                </DropdownItem>
                <DropdownItem onSelect={() => setDialog('cancel')}>Remove from waitlist</DropdownItem>
                <DropdownItem onSelect={() => setDialog('left')}>Mark as left</DropdownItem>
              </DropdownContent>
            </Dropdown>
          ) : null}
        </div>
        {hold ? <HoldControls hold={hold} party={party} className="mx-2 mb-2" /> : null}
      </div>
      {dialog ? <PartyDialog party={party} action={dialog} onClose={() => setDialog(null)} /> : null}
    </li>
  )
}

function PartyDialog({ party, action, onClose }: { party: QueueParty; action: PartyAction; onClose: () => void }) {
  const { updateParty, pending } = useSeating()
  const [size, setSize] = useState(party.size)
  const [reason, setReason] = useState('')
  const id = useId()
  const title =
    action === 'update'
      ? `Change ${party.queue_code}'s party size`
      : action === 'cancel'
        ? `Remove ${party.queue_code} from the waitlist?`
        : `Mark ${party.queue_code} as left?`
  const description =
    action === 'update'
      ? 'The party keeps its place in the queue.'
      : action === 'cancel'
        ? 'Use this when the party cancels. Any hold for them is released.'
        : 'Use this when the party walked away. Any hold for them is released.'
  const label = action === 'update' ? 'Save size' : action === 'cancel' ? 'Remove party' : 'Mark as left'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            updateParty(party, action, action === 'update' ? { size } : { reason }, onClose)
          }}
          className="flex flex-col gap-3"
        >
          {action === 'update' ? (
            <div>
              <label htmlFor={id} className="mb-1.5 block text-[14px] font-bold">
                Party size
              </label>
              <input
                id={id}
                type="number"
                min={1}
                max={20}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-11 w-full rounded-[10px] border border-[#c9d0ca] px-3 text-[15px] outline-none focus:border-ink"
              />
            </div>
          ) : (
            <div>
              <label htmlFor={id} className="mb-1.5 block text-[14px] font-bold">
                Reason <span className="font-medium text-pewter">(optional)</span>
              </label>
              <input
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-11 w-full rounded-[10px] border border-[#c9d0ca] px-3 text-[15px] outline-none focus:border-ink"
              />
            </div>
          )}
          <Button type="submit" tone="primary" size="lg" pending={pending?.startsWith(`party:${party.party_id}`)}>
            {label}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
