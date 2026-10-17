import { ArrowLeftRight, ChevronDown, ChevronUp, Pause, Play, RotateCcw, Sparkles, UserRound, Wand2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import type { Narration } from '@/features/demo/api'
import { SPEEDS, VideoPanel } from '@/features/demo/VideoPanel'
import { DEMO_VIDEO_SRC } from '@/config'
import { cn } from '@/lib/cn'
import { useReplay } from './ReplayProvider'


/** Height of the rail variant, so the panel below it and the swapped floor card can line up. */
export const RAIL_DOCK_HEIGHT = 362

/** Narration lines often start with their source ("Camera: …"); drop it where a label already says so. */
export function withoutSource(text: string, label: string): string {
  return text.startsWith(`${label}: `) ? text.slice(label.length + 2) : text
}

export const KIND_LABEL: Record<Narration['kind'], string> = {
  autopilot: 'Team',
  camera: 'Camera',
  gemini: 'Gemini',
  arrival: 'Host stand',
  rules: 'Rules',
}

function clock(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

/** The latest narration line: over the footage when it's large, under it when it's small. */
function Caption({ narration, media, below }: { narration: Narration[]; media: number; below?: boolean }) {
  const latest = narration[narration.length - 1]
  if (below) {
    return (
      // The clamp sits on an inner span: as a flex item the paragraph itself can't be a -webkit-box.
      <p className="m-0 min-h-0 flex-1 overflow-hidden px-3 py-2 text-[13px] leading-snug text-ink" aria-live="polite">
        <span className="line-clamp-2" title={latest?.text}>
          {latest ? (
            <>
              <b className="mr-1.5 text-[12px] text-review-deep">{KIND_LABEL[latest.kind]}</b>
              {withoutSource(latest.text, KIND_LABEL[latest.kind])}
            </>
          ) : (
            <span className="text-pewter">What the camera and team do appears here.</span>
          )}
        </span>
      </p>
    )
  }
  if (!latest || media - latest.t > 2.5) return null
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-16 flex justify-center" aria-live="polite">
      <p className="m-0 max-w-full rounded-lg bg-black/75 px-3 py-1.5 text-center text-[14px] text-white">
        <b className="mr-1.5 text-[11px] text-[#ecb240]">{KIND_LABEL[latest.kind]}</b>
        {withoutSource(latest.text, KIND_LABEL[latest.kind])}
      </p>
    </div>
  )
}

/** Play, speed, restart and progress, drawn under the picture where there's no room on it. */
function Transport() {
  const replay = useReplay()
  const duration = replay.session?.duration_s ?? 0
  const shiftS = replay.mediaNow * (replay.session?.time_scale ?? 1)
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-rule px-2">
      <button
        type="button"
        onClick={() => replay.setPlaying(!replay.playing)}
        disabled={replay.ended}
        className="grid size-8 place-items-center rounded-lg text-ink hover:bg-wash disabled:opacity-40"
        aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
      >
        {replay.playing && !replay.ended ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </button>
      <div role="group" aria-label="Playback speed" className="flex rounded-md bg-wash p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => replay.setSpeed(s)}
            aria-pressed={s === replay.speed}
            className={cn(
              'tabular rounded px-1.5 py-0.5 text-[12px] font-semibold',
              s === replay.speed ? 'bg-white text-ink shadow-sm' : 'text-pewter hover:text-ink',
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={replay.restart}
        className="grid size-8 place-items-center rounded-lg text-ink hover:bg-wash"
        aria-label="Start a new shift"
      >
        <RotateCcw className="size-4" aria-hidden />
      </button>
      <div className="mx-1 h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-rule" aria-hidden>
        <div className="h-full bg-ink" style={{ width: `${duration ? Math.min(100, (replay.mediaNow / duration) * 100) : 0}%` }} />
      </div>
      <span className="tabular shrink-0 text-[12px] text-pewter" title={`Shift clock +${Math.round(shiftS)} s`}>
        {clock(replay.mediaNow)} / {clock(duration)}
      </span>
    </div>
  )
}

interface CameraDockProps {
  /** rail: beside the floor; full: swapped into the floor area; strip: collapsible, on phones. */
  variant: 'rail' | 'full' | 'strip'
  style?: CSSProperties
  className?: string
  onSwap?: () => void
  onOpenManager: () => void
}

/**
 * The replay's camera with its table zones and controls. Its <video> drives the demo clock, so the
 * dock stays mounted for the whole session; collapsing it only hides the picture.
 */
export function CameraDock({ variant, style, className, onSwap, onOpenManager }: CameraDockProps) {
  const replay = useReplay()
  const [collapsed, setCollapsed] = useState(false)
  if (!replay.session) return null
  const rail = variant === 'rail'
  const strip = variant === 'strip'
  const latest = replay.narration[replay.narration.length - 1]

  return (
    <section
      aria-label="Camera 02, recorded replay"
      className={cn(
        'flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-white shadow-[var(--shadow-float)]',
        className,
      )}
      style={rail ? { height: RAIL_DOCK_HEIGHT, ...style } : style}
    >
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-rule px-2">
        <div role="radiogroup" aria-label="Replay mode" className="flex rounded-lg bg-wash p-0.5">
          {(
            [
              ['autoplay', 'Autoplay', Wand2],
              ['guided', 'Guided', UserRound],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={replay.mode === mode}
              onClick={() => replay.changeMode(mode)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-semibold',
                replay.mode === mode ? 'bg-white text-ink shadow-sm' : 'text-pewter hover:text-ink',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        {strip ? (
          <>
            <button
              type="button"
              onClick={() => replay.setPlaying(!replay.playing)}
              className="grid size-8 place-items-center rounded-lg text-ink hover:bg-wash"
              aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
            >
              {replay.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-pewter">
              {collapsed && latest
                ? `${KIND_LABEL[latest.kind]}: ${withoutSource(latest.text, KIND_LABEL[latest.kind])}`
                : `${replay.mediaNow.toFixed(1)} s of ${replay.session.duration_s.toFixed(0)} s`}
            </span>
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="grid size-8 place-items-center rounded-lg text-ink hover:bg-wash"
              aria-label={collapsed ? 'Show camera' : 'Hide camera'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
          </>
        ) : (
          <>
            <span className="flex-1" />
            {onSwap ? (
              <button
                type="button"
                onClick={onSwap}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-ink hover:bg-wash"
                aria-label={variant === 'full' ? 'Show the floor large' : 'Show the camera large'}
              >
                <ArrowLeftRight className="size-3.5" aria-hidden />
                {variant === 'full' ? 'Floor large' : 'Camera large'}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className={cn('relative shrink-0 bg-black', collapsed && 'h-0 overflow-hidden')}>
        {replay.timeline ? (
          <VideoPanel
            key={replay.session.session_id}
            src={DEMO_VIDEO_SRC}
            timeline={replay.timeline}
            speed={replay.speed}
            onSpeed={replay.setSpeed}
            playing={replay.playing && !replay.ended}
            onPlaying={replay.setPlaying}
            onTime={replay.onTime}
            onEnded={() => replay.setEnded(true)}
            onRestart={replay.restart}
            timeScale={replay.session.time_scale}
            chrome={variant === 'full' ? 'full' : 'minimal'}
          />
        ) : (
          <div className="grid aspect-video place-items-center text-[13px] text-white/70">Loading the replay</div>
        )}
        {variant === 'full' ? <Caption narration={replay.narration} media={replay.mediaNow} /> : null}
        {replay.ended ? (
          <div className="absolute inset-0 grid place-items-center bg-black/65 p-3 text-center text-white">
            <div>
              <p className={cn('m-0 mb-1 font-bold', variant === 'full' ? 'text-[20px]' : 'text-[16px]')}>That was the shift.</p>
              <p className="m-0 mb-3 text-[13px] text-white/80">See the briefing and timings, or run it again.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button tone="primary" size="sm" onClick={onOpenManager}>
                  <Sparkles aria-hidden />
                  Open manager view
                </Button>
                <Button tone="secondary" size="sm" onClick={replay.restart}>
                  <RotateCcw aria-hidden />
                  New shift
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {rail ? <Transport /> : null}
      {rail || (strip && !collapsed) ? <Caption narration={replay.narration} media={replay.mediaNow} below /> : null}
    </section>
  )
}
