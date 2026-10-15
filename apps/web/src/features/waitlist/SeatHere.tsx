import { Armchair } from 'lucide-react'
import { useBoard } from '@/lib/api/board'
import { holdsByTable, unsuitable, waitlistOf } from '@/lib/api/seating'
import type { TableBoardEntry } from '@/lib/api/types'
import { formatMinutes, minutesSince } from '@/lib/domain/time'
import { HoldControls } from './HoldControls'
import { SeatOption } from './SeatOption'
import { useSeating } from './useSeating'

/**
 * Table-first seating in the inspector: who could sit at this ready table, or the live hold on it.
 * Choosing by hand is how hosts seat at tables the rules won't suggest (for example a camera table
 * without current evidence); the API then asks for an override reason.
 */
export function SeatHere({ entry }: { entry: TableBoardEntry }) {
  const { board, serverNow } = useBoard()
  const { canManage } = useSeating()
  const id = entry.table.table_id
  const hold = holdsByTable(board).get(id)
  const waitlist = waitlistOf(board)

  if (hold) {
    const party = waitlist.find((p) => p.party_id === hold.party_id)
    return (
      <section className="border-b border-rule px-5 py-4" aria-label="Seating hold">
        <HoldControls hold={hold} party={party} />
      </section>
    )
  }

  if (!canManage || entry.session.operational_state !== 'ready' || entry.table.blocked) return null

  const waiting = waitlist.filter((p) => p.status === 'waiting')
  const fits = waiting.filter((p) => !unsuitable(p, entry))

  return (
    <section className="border-b border-rule px-5 py-4" aria-labelledby="seat-here-title">
      <h3 id="seat-here-title" className="m-0 mb-2.5 flex items-center gap-2 text-[14px] font-bold">
        <Armchair className="size-4" aria-hidden />
        Seat a party here
      </h3>
      {waiting.length === 0 ? (
        <p className="m-0 text-[13.5px] text-pewter">Nobody is waiting. Add walk-ins from the Waitlist tab.</p>
      ) : fits.length === 0 ? (
        <p className="m-0 text-[13.5px] text-pewter">
          No waiting party fits {id}: {unsuitable(waiting[0], entry)}.
        </p>
      ) : (
        <div className="space-y-1.5">
          {fits.map((party) => (
            <SeatOption
              key={party.party_id}
              party={party}
              target={{ table_id: id, table_version: entry.session.state_version }}
              title={
                <>
                  <span className="font-serif text-[18px] font-normal">{party.queue_code}</span>
                  <span className="font-semibold">Party of {party.size}</span>
                </>
              }
              detail={`Waiting ${formatMinutes(minutesSince(party.arrival_at, serverNow))}${
                party.requirements.length ? `. Needs ${party.requirements.join(', ')}` : ''
              }`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
