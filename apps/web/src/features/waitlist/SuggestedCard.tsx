import { Sparkles } from 'lucide-react'
import type { Recommendation } from '@/lib/api/types'
import { SeatOption } from './SeatOption'

/** The rules' suggestion for the oldest seatable party, with the reasons other parties were skipped. */
export function SuggestedCard({
  rec,
  loading,
  onSelectTable,
}: {
  rec: Recommendation | undefined
  loading: boolean
  onSelectTable: (id: string) => void
}) {
  if (!rec) {
    return loading ? <div className="h-24 animate-pulse rounded-xl bg-wash" aria-hidden /> : null
  }

  return (
    <section aria-labelledby="suggested-title" className="rounded-xl border border-rule bg-wash p-3">
      <h3 id="suggested-title" className="m-0 mb-2 flex items-center gap-1.5 text-[14px] font-bold">
        <Sparkles className="size-4 text-ready" aria-hidden />
        {rec.party ? rec.message : 'Suggested seating'}
      </h3>
      {rec.party && rec.tables.length ? (
        <div className="space-y-1.5">
          {rec.tables.map((option, i) => (
            <SeatOption
              key={option.table_id}
              party={rec.party!}
              target={option}
              title={
                <>
                  <span className="font-serif text-[18px] font-normal">{option.table_id}</span>
                  {i === 0 ? <span className="text-[12px] font-semibold whitespace-nowrap text-ready-deep">Best fit</span> : null}
                </>
              }
              detail={option.reason}
              evidence={option.evidence}
              onSelectTable={onSelectTable}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-[13.5px] text-pewter">{rec.message}</p>
      )}
      {rec.skipped.length ? (
        <ul className="m-0 mt-2.5 list-none space-y-1 p-0 text-[13px] leading-snug text-pewter">
          {rec.skipped.map((s) => (
            <li key={s.party_id}>
              <b className="text-ink">{s.queue_code}</b> can't be seated by the rules yet: {s.reason}.
            </li>
          ))}
        </ul>
      ) : null}
      {rec.skipped.length || !rec.tables.length ? (
        <p className="m-0 mt-2 text-[12.5px] text-pewter">
          You can still seat a party by hand: pick a ready table on the floor.
        </p>
      ) : null}
    </section>
  )
}
