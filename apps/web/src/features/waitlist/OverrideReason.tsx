import { TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Shown when the API asks for a host override (a queue skip, or a table without current camera
 * evidence). The reason is recorded with the hold.
 */
export function OverrideReason({
  message,
  pending,
  onSubmit,
  onCancel,
}: {
  message: string
  pending: boolean
  onSubmit: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const id = useId()
  // "Host override reason required: T6 has no current camera evidence." -> the part after the colon.
  const detail = message.replace(/^Host override reason required:\s*/i, '')

  return (
    <form
      className="mt-2 rounded-xl border border-review/50 bg-review-tint p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (reason.trim()) onSubmit(reason)
      }}
    >
      <p className="m-0 mb-2 flex items-start gap-2 text-[13.5px] text-review-deep">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Needs a host override: {detail} Check the table in person, then say why it's fine.
        </span>
      </p>
      <label htmlFor={id} className="sr-only">
        Override reason
      </label>
      <input
        id={id}
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Checked in person: table is reset"
        className="h-10 w-full rounded-lg border border-[#c9d0ca] bg-white px-3 text-[14px] outline-none focus:border-ink"
      />
      <div className="mt-2 flex gap-2">
        <Button type="submit" tone="primary" size="sm" className="flex-1" pending={pending} disabled={!reason.trim()}>
          Hold anyway
        </Button>
        <Button tone="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
