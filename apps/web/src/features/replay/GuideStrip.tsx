import { Cctv, History, ListChecks, Play, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { hints, type Hint } from '@/features/demo/guide'
import { useBoard } from '@/lib/api/board'
import { useRecommendation } from '@/lib/api/seating'
import { cn } from '@/lib/cn'
import { KIND_LABEL, withoutSource } from './CameraDock'
import { useReplay } from './ReplayProvider'

const SOURCE: Record<Hint['source'], { label: string; icon: typeof Cctv }> = {
  camera: { label: 'Camera', icon: Cctv },
  gemini: { label: 'Gemini', icon: Sparkles },
  rules: { label: 'Rules', icon: ListChecks },
}
const ROLE_LABEL: Record<Hint['role'], string> = { host: 'host', staff: 'floor staff', manager: 'manager' }

/** Next steps from the board, camera evidence and Gemini checks, most urgent first. */
function useHints(): Hint[] {
  const { entries } = useBoard()
  const rec = useRecommendation().data
  return useMemo(() => hints(entries, rec), [entries, rec])
}

/**
 * In Guided mode, pauses the replay on each new camera or Gemini event so the viewer can act.
 * Rendered once for the whole floor so it keeps watching while the inspector is open.
 */
export function GuideAutoPause() {
  const guide = useHints()
  const { session, mode, setPlaying, seenHints, setFreshHint } = useReplay()
  useEffect(() => {
    if (!session) return
    const novel = guide.find((h) => h.pause && !seenHints.current.has(h.id))
    for (const h of guide) seenHints.current.add(h.id)
    if (novel && mode === 'guided') {
      setPlaying(false)
      setFreshHint(novel.id)
    }
  }, [guide, session, mode, setPlaying, seenHints, setFreshHint])
  return null
}

interface HintProps {
  onFollow: (hint: Hint) => void
  /** Hovering or focusing a step points at its table on the floor. */
  onPoint?: (tableId: string | null) => void
}

function HintCard({ hint, fresh, detail, onFollow, onPoint }: HintProps & { hint: Hint; fresh: boolean; detail: boolean }) {
  const { label, icon: Icon } = SOURCE[hint.source]
  return (
    <button
      type="button"
      onClick={() => onFollow(hint)}
      onPointerEnter={() => onPoint?.(hint.tableId)}
      onPointerLeave={() => onPoint?.(null)}
      onFocus={() => onPoint?.(hint.tableId)}
      onBlur={() => onPoint?.(null)}
      className={cn(
        'flex w-full gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-left hover:border-ink',
        fresh ? 'border-review ring-2 ring-review/30' : 'border-rule',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', hint.source === 'rules' ? 'text-pewter' : 'text-review')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-snug font-bold">{hint.title}</span>
        {detail && hint.detail ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-pewter">{hint.detail}</span> : null}
        <span className="mt-1 block text-[12px] text-pewter">
          {label}, for {ROLE_LABEL[hint.role]}
        </span>
      </span>
    </button>
  )
}

function PausedBar() {
  const replay = useReplay()
  return (
    <div className="flex items-center gap-2 rounded-xl border border-review/40 bg-review-tint px-3 py-2 text-[13px] text-review-deep">
      <span className="flex-1 font-semibold">Paused so you can act.</span>
      <button
        type="button"
        onClick={() => replay.setPlaying(true)}
        className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-ink shadow-sm hover:bg-wash"
      >
        <Play className="size-3.5" aria-hidden />
        Resume
      </button>
    </div>
  )
}

function NextSteps({ onFollow, onPoint }: HintProps) {
  const replay = useReplay()
  const guide = useHints()
  const paused = !replay.playing && !replay.ended && replay.mode === 'guided'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {paused ? (
        <PausedBar />
      ) : (
        <p className="m-0 text-[12.5px] text-pewter">
          {replay.mode === 'autoplay'
            ? 'The team acts on these by itself. Switch to Guided to act yourself.'
            : 'Camera, Gemini and rules suggest; you decide.'}
        </p>
      )}
      {guide.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-rule px-3 py-4 text-center text-[13px] text-pewter">
          All calm. TurnWise flags the next handoff here.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {guide.slice(0, 4).map((h) => (
            <li key={h.id}>
              <HintCard hint={h} fresh={h.id === replay.freshHint} detail onFollow={onFollow} onPoint={onPoint} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ShiftLog({ className }: { className?: string }) {
  const { narration } = useReplay()
  if (narration.length === 0) return <p className={cn('m-0 p-4 text-[13px] text-pewter', className)}>Nothing has happened yet.</p>
  return (
    <ol className={cn('m-0 list-none space-y-2 overflow-y-auto p-3 text-[13px] leading-snug', className)}>
      {[...narration].reverse().map((n, i) => (
        <li key={`${n.t}-${i}`} className="flex gap-2.5">
          <span className="tabular w-11 shrink-0 text-right text-pewter">{n.t.toFixed(1)} s</span>
          <span>
            <b>{KIND_LABEL[n.kind]}</b> {withoutSource(n.text, KIND_LABEL[n.kind])}
          </span>
        </li>
      ))}
    </ol>
  )
}

type PanelTab = 'next' | 'log'

/** The replay rail's lower panel: next steps and the shift log. */
export function ReplayPanel({ onFollow, onPoint }: HintProps) {
  const replay = useReplay()
  const [tab, setTab] = useState<PanelTab>('next')
  const tabs: [PanelTab, string][] = [
    ['next', 'Next steps'],
    ['log', 'Log'],
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Replay" className="flex shrink-0 gap-1 border-b border-rule px-3 pt-2.5">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-[14px] font-semibold',
              tab === id ? 'border-ink text-ink' : 'border-transparent text-pewter hover:text-ink',
            )}
          >
            {id === 'log' ? <History className="size-3.5" aria-hidden /> : null}
            {label}
            {id === 'log' && replay.narration.length ? (
              <span className="tabular rounded-full bg-wash px-1.5 text-[11.5px] font-bold text-pewter">{replay.narration.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === 'next' ? (
        <NextSteps onFollow={onFollow} onPoint={onPoint} />
      ) : (
        <ShiftLog className="min-h-0 flex-1" />
      )}
    </div>
  )
}

/** The most urgent next step on its own, for tablets and phones. */
export function GuideStrip({ onFollow, className }: HintProps & { className?: string }) {
  const replay = useReplay()
  const guide = useHints()
  if (!replay.session) return null
  const paused = !replay.playing && !replay.ended && replay.mode === 'guided'
  const top = guide[0]
  return (
    <section aria-label="Next step" className={cn('grid gap-1.5', className)}>
      {paused ? <PausedBar /> : null}
      {top ? (
        <HintCard hint={top} fresh={top.id === replay.freshHint} detail={false} onFollow={onFollow} />
      ) : (
        <p className="m-0 rounded-xl border border-dashed border-rule bg-white px-3 py-2.5 text-[13px] text-pewter">
          All calm. TurnWise flags the next handoff here.
        </p>
      )}
    </section>
  )
}
