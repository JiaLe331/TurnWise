import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { actionId, useBoard } from '@/lib/api/board'
import { nextQueueCode, seatingAttributes, waitlistOf } from '@/lib/api/seating'
import { cn } from '@/lib/cn'
import { useSeating } from './useSeating'

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Adds an anonymous walk-in: a queue code, a party size, and any seating requirement. */
export function AddPartyForm() {
  const { board, entries } = useBoard()
  const { addParty, pending, paused } = useSeating()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [size, setSize] = useState(2)
  const [needs, setNeeds] = useState<string[]>([])
  const codeId = useId()
  const sizeId = useId()
  const attributes = seatingAttributes(entries)

  const start = () => {
    setCode(nextQueueCode(waitlistOf(board)))
    setSize(2)
    setNeeds([])
    setOpen(true)
  }

  if (!open) {
    return (
      <Button tone="primary" size="md" block onClick={start} disabled={paused}>
        <Plus aria-hidden />
        Add party
      </Button>
    )
  }

  const valid = code.trim().length > 0 && code.trim().length <= 16 && size >= 1 && size <= 20

  return (
    <form
      className="rounded-xl border border-rule bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) addParty(code, size, needs, () => setOpen(false))
      }}
    >
      <div className="flex gap-3">
        <div className="w-24">
          <label htmlFor={codeId} className="mb-1 block text-[13px] font-semibold text-pewter">
            Queue code
          </label>
          <input
            id={codeId}
            value={code}
            maxLength={16}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="h-10 w-full rounded-lg border border-[#c9d0ca] px-2.5 font-serif text-[18px] outline-none focus:border-ink"
          />
        </div>
        <div className="flex-1">
          <label htmlFor={sizeId} className="mb-1 block text-[13px] font-semibold text-pewter">
            Party size
          </label>
          <input
            id={sizeId}
            type="number"
            min={1}
            max={20}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="h-10 w-full rounded-lg border border-[#c9d0ca] px-2.5 text-[15px] tabular outline-none focus:border-ink"
          />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-8 gap-1" role="group" aria-label="Quick party size">
        {SIZES.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSize(n)}
            aria-pressed={size === n}
            className={cn(
              'h-9 rounded-lg border text-[14px] font-semibold tabular',
              size === n ? 'border-ink bg-ink text-white' : 'border-rule bg-white text-ink hover:bg-wash',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {attributes.length ? (
        <fieldset className="m-0 mt-3 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold text-pewter">Needs</legend>
          <div className="flex flex-wrap gap-1.5">
            {attributes.map((a) => {
              const on = needs.includes(a)
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setNeeds(on ? needs.filter((n) => n !== a) : [...needs, a])}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[13px] font-semibold',
                    on ? 'border-ink bg-ink text-white' : 'border-rule bg-white text-ink hover:bg-wash',
                  )}
                >
                  {titleCase(a)}
                </button>
              )
            })}
          </div>
        </fieldset>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button type="submit" tone="primary" size="md" className="flex-1" disabled={!valid || paused} pending={pending === actionId({ kind: 'party-create', request: { queue_code: code, size, requirements: needs } })}>
          Add to waitlist
        </Button>
        <Button tone="ghost" size="md" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
