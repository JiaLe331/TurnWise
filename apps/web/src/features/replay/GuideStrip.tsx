import { History, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { hints, type Hint } from '@/features/demo/guide'
import type { Narration } from '@/features/demo/api'
import { useBoard } from '@/lib/api/board'
import { useRecommendation } from '@/lib/api/seating'
import { cn } from '@/lib/cn'
import { useReplay } from './ReplayProvider'

const SOURCE_LABEL: Record<Hint['source'], string> = { camera: 'Camera', gemini: 'Gemini', rules: 'Rules' }
const ROLE_LABEL: Record<Hint['role'], string> = { host: 'host', staff: 'floor staff', manager: 'manager' }
/** Narration lines often start with their source ("Camera: …"); drop it where a label already says so. */
function withoutSource(text: string, label: string): string {
  return text.startsWith(`${label}: `) ? text.slice(label.length + 2) : text
}

const KIND_LABEL: Record<Narration['kind'], string> = {
  autopilot: 'Team',
  camera: 'Camera',
  gemini: 'Gemini',
  arrival: 'Host stand',
  rules: 'Rules',
}

/**
 * "What to do next" during a replay: suggestions from the board, camera evidence and Gemini checks.
 * In Guided mode the replay pauses on each new camera or Gemini event so the viewer can act.
 */
export function GuideStrip({
  onFollow,
  compact = false,
  className,
}: {
  onFollow: (hint: Hint) => void
  compact?: boolean
  className?: string
}) {
  const replay = useReplay()
  const { entries } = useBoard()
  const rec = useRecommendation().data
  const guide = useMemo(() => hints(entries, rec), [entries, rec])
  const seen = useRef(new Set<string>())
  const [fresh, setFresh] = useState<string | null>(null)
  const { mode, setPlaying } = replay

  useEffect(() => {
    const novel = guide.find((h) => h.pause && !seen.current.has(h.id))
    for (const h of guide) seen.current.add(h.id)
    if (novel && mode === 'guided') {
      setPlaying(false)
      setFresh(novel.id)
    }
  }, [guide, mode, setPlaying])

  if (!replay.session) return null
  const shown = guide.slice(0, compact ? 1 : 3)
  const paused = !replay.playing && !replay.ended && mode === 'guided'

  return (
    <section
      aria-label="What to do next"
      className={cn('rounded-[12px] border border-rule bg-white/95 px-2.5 py-2 shadow-[var(--shadow-tag)]', className)}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
        <Sparkles className="size-3.5 text-review" aria-hidden />
        <b className="shrink-0">What to do next</b>
        <span className="truncate text-pewter">
          {paused
            ? 'Paused so you can act. Press play on the camera when ready.'
            : mode === 'autoplay'
              ? 'The team acts on these by itself. Switch to Guided to act yourself.'
              : 'Camera, Gemini and rules suggest; you decide.'}
        </span>
        {replay.narration.length ? (
          <details className="relative ml-auto shrink-0">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-pewter hover:bg-wash">
              <History className="size-3.5" aria-hidden />
              Shift log ({replay.narration.length})
            </summary>
            <ol className="absolute right-0 z-30 mt-1 max-h-64 w-80 list-none space-y-1 overflow-y-auto rounded-xl border border-rule bg-white p-2.5 text-[12.5px] shadow-[var(--shadow-float)]">
              {[...replay.narration].reverse().map((n, i) => (
                <li key={`${n.t}-${i}`}>
                  <span className="tabular text-pewter">{n.t.toFixed(1)} s</span> <b>{KIND_LABEL[n.kind]}:</b> {withoutSource(n.text, KIND_LABEL[n.kind])}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="m-0 text-[13px] text-pewter">All calm. TurnWise will flag the next handoff.</p>
      ) : (
        <ul className={cn('m-0 grid list-none gap-1.5 p-0', !compact && 'md:grid-cols-3')}>
          {shown.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onFollow(h)}
                className={cn(
                  'h-full w-full rounded-lg border bg-linen px-2.5 py-1.5 text-left hover:border-ink',
                  h.id === fresh ? 'border-review ring-2 ring-review/30' : 'border-rule',
                )}
              >
                <span className="block text-[11.5px] font-semibold text-pewter">
                  {SOURCE_LABEL[h.source]}, for {ROLE_LABEL[h.role]}
                </span>
                <span className="block text-[13px] leading-snug font-bold">{h.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
