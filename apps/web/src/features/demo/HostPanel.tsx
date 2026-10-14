import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Armchair, Clock3, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useBoard } from '@/lib/api/board'
import { ApiError, apiScopeKey } from '@/lib/api/client'
import type { QueueParty, Recommendation, SeatingHold, TableOption } from '@/lib/api/types'
import { formatMinutes, minutesSince } from '@/lib/domain/time'
import { useIdentity } from '@/lib/identity/dev-identity'
import { outletApi } from './api'

export function useRecommendation() {
  const { board } = useBoard()
  return useQuery({
    queryKey: ['recommendation', apiScopeKey(), board?.generated_at],
    queryFn: outletApi.recommendation,
    enabled: !!board,
    placeholderData: (prev) => prev,
  })
}

export function HostPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const { board, serverNow, refetch } = useBoard()
  const { actor } = useIdentity()
  const rec = useRecommendation().data
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [override, setOverride] = useState<{ party: QueueParty; option: TableOption; message: string } | null>(null)
  const [reason, setReason] = useState('')
  const waitlist = board?.waitlist ?? []
  const holds = board?.holds ?? []

  const done = () => {
    refetch()
    void queryClient.invalidateQueries({ queryKey: ['recommendation'] })
  }

  async function hold(party: QueueParty, option: TableOption, overrideReason?: string) {
    setPending(option.table_id)
    try {
      await outletApi.createHold(actor, {
        party_id: party.party_id,
        table_id: option.table_id,
        party_version: party.version,
        table_version: option.table_version,
        override_reason: overrideReason,
      })
      toast.success(`${option.table_id} held for ${party.queue_code} for 60 s`)
      setOverride(null)
      setReason('')
      done()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'override_reason_required') {
        setOverride({ party, option, message: error.message })
      } else toast.error(error instanceof Error ? error.message : 'Could not hold the table.')
    } finally {
      setPending(null)
    }
  }

  async function act(h: SeatingHold, action: 'confirm' | 'cancel') {
    setPending(h.hold_id)
    try {
      await outletApi.holdAction(actor, h.hold_id, action, h.version)
      toast.success(action === 'confirm' ? `Party seated at ${h.table_id}` : 'Hold released')
      done()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the hold.')
      done()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
      <section aria-label="Waitlist">
        <h3 className="m-0 mb-2 flex items-center gap-2 text-[15px] font-bold">
          <Users className="size-4" aria-hidden /> Waitlist
          <span className="text-[13px] font-normal text-pewter">walk-ins are scripted for the demo</span>
        </h3>
        {waitlist.length === 0 ? (
          <p className="m-0 rounded-xl bg-wash px-3 py-3 text-[14px] text-pewter">Nobody waiting yet.</p>
        ) : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {waitlist.map((p) => (
              <li key={p.party_id} className="flex items-center justify-between rounded-xl border border-rule bg-white px-3 py-2">
                <span className="font-bold">
                  {p.queue_code} <span className="font-normal text-pewter">party of {p.size}</span>
                  {p.requirements.length ? <span className="ml-1 text-[13px] text-pewter">· {p.requirements.join(', ')}</span> : null}
                </span>
                <span className="flex items-center gap-1 text-[13px] text-pewter">
                  {p.status === 'on_hold' ? 'on hold' : <><Clock3 className="size-3.5" aria-hidden />{formatMinutes(minutesSince(p.arrival_at, serverNow))}</>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Seating recommendation">
        <h3 className="m-0 mb-2 flex items-center gap-2 text-[15px] font-bold">
          <Armchair className="size-4" aria-hidden /> Recommendation
        </h3>
        {holds.length ? (
          <div className="mb-2 space-y-1.5">
            {holds.map((h) => {
              const party = waitlist.find((p) => p.party_id === h.party_id)
              const left = Math.max(0, Math.round((Date.parse(h.expires_at) - serverNow) / 1000))
              return (
                <div key={h.hold_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ready/40 bg-ready-tint px-3 py-2">
                  <span className="flex-1 font-bold">
                    {h.table_id} held for {party?.queue_code ?? 'party'} <span className="font-normal text-pewter">· {left}s left on the shift clock</span>
                  </span>
                  <Button size="sm" tone="ready" pending={pending === h.hold_id} onClick={() => act(h, 'confirm')}>
                    Mark seated
                  </Button>
                  <Button size="sm" tone="ghost" onClick={() => act(h, 'cancel')}>Release</Button>
                </div>
              )
            })}
          </div>
        ) : null}
        <RecommendationCard rec={rec} pending={pending} onHold={hold} onSelect={onSelect} />
        {override ? (
          <div className="mt-2 rounded-xl border border-review/40 bg-review-tint p-3">
            <p className="m-0 mb-2 text-[14px]">{override.message}</p>
            <div className="flex gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason, e.g. checked the table in person"
                className="h-9 flex-1 rounded-lg border border-rule bg-white px-3 text-[14px]"
                aria-label="Override reason"
              />
              <Button size="sm" tone="primary" disabled={!reason.trim()} onClick={() => hold(override.party, override.option, reason)}>
                Hold anyway
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function RecommendationCard({
  rec,
  pending,
  onHold,
  onSelect,
}: {
  rec: Recommendation | undefined
  pending: string | null
  onHold: (party: QueueParty, option: TableOption) => void
  onSelect: (id: string) => void
}) {
  if (!rec) return <div className="h-24 animate-pulse rounded-xl bg-wash" />
  return (
    <div className="rounded-xl border border-rule bg-white p-3">
      <p className="m-0 mb-2 font-bold">{rec.message}</p>
      {rec.party
        ? rec.tables.map((t) => (
            <div key={t.table_id} className="mb-1.5 flex items-center gap-2 last:mb-0">
              <button type="button" onClick={() => onSelect(t.table_id)} className="flex-1 text-left text-[14px] hover:underline">
                {t.reason}
              </button>
              <Button size="sm" tone="primary" pending={pending === t.table_id} onClick={() => onHold(rec.party!, t)}>
                Hold {t.table_id}
              </Button>
            </div>
          ))
        : null}
      {rec.skipped.length ? (
        <p className="m-0 mt-2 text-[13px] text-pewter">
          Waiting longer: {rec.skipped.map((s) => `${s.queue_code} (${s.reason})`).join('; ')}
        </p>
      ) : null}
    </div>
  )
}
