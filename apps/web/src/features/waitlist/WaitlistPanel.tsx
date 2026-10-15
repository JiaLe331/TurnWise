import { Users } from 'lucide-react'
import { useBoard } from '@/lib/api/board'
import { holdsByParty, useHoldExpiryNotice, waitlistOf } from '@/lib/api/seating'
import type { Recommendation } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { AddPartyForm } from './AddPartyForm'
import { PartyRow } from './PartyRow'
import { SuggestedCard } from './SuggestedCard'
import { useSeating } from './useSeating'

interface WaitlistPanelProps {
  rec: Recommendation | undefined
  recLoading: boolean
  selectedPartyId: string | null
  onSelectParty: (id: string | null) => void
  onSelectTable: (id: string) => void
  className?: string
}

/** The host's queue: add walk-ins, follow the rules' suggestion, and seat parties with holds. */
export function WaitlistPanel({ rec, recLoading, selectedPartyId, onSelectParty, onSelectTable, className }: WaitlistPanelProps) {
  const { board, freshness } = useBoard()
  const { canManage } = useSeating()
  useHoldExpiryNotice()
  const waitlist = waitlistOf(board)
  const holds = holdsByParty(board)

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="space-y-3 overflow-y-auto px-3 pt-3 pb-4">
        {canManage ? (
          <AddPartyForm />
        ) : (
          <p className="m-0 rounded-lg bg-wash px-3 py-2 text-[13px] text-pewter">Hosts and managers seat parties.</p>
        )}
        {freshness !== 'loading' && waitlist.length > 0 ? (
          <SuggestedCard rec={rec} loading={recLoading} onSelectTable={onSelectTable} />
        ) : null}
        <section aria-labelledby="queue-title">
          <h3 id="queue-title" className="m-0 mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-pewter">
            <Users className="size-3.5" aria-hidden />
            In the queue, oldest first
          </h3>
          {freshness === 'loading' ? (
            <div className="h-14 animate-pulse rounded-xl bg-wash" aria-hidden />
          ) : waitlist.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-rule px-3 py-4 text-center text-[13.5px] text-pewter">
              Nobody is waiting. Add a walk-in when a party arrives.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-1.5 p-0">
              {waitlist.map((party) => (
                <PartyRow
                  key={party.party_id}
                  party={party}
                  hold={holds.get(party.party_id)}
                  selected={party.party_id === selectedPartyId}
                  onSelect={onSelectParty}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
