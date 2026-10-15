import { ArrowLeftRight, ChevronDown, ChevronUp, Pause, Play, RotateCcw, Sparkles, UserRound, Wand2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import type { Narration } from '@/features/demo/api'
import { VideoPanel } from '@/features/demo/VideoPanel'
import { cn } from '@/lib/cn'
import { useReplay } from './ReplayProvider'

const VIDEO_SRC = '/demo-media/mixkit-720p.mp4'

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

/** The latest narration line, shown over the footage for a few media seconds. */
function Caption({ narration, media, small }: { narration: Narration[]; media: number; small?: boolean }) {
  const latest = narration[narration.length - 1]
  if (small) {
    // Small cards keep the picture clear: the latest line sits under it instead of over it.
    return (
      <p className="m-0 min-h-[38px] border-t border-rule bg-white px-2.5 py-1.5 text-[12.5px] leading-snug text-ink" aria-live="polite">
        {latest ? (
          <>
            <b className="mr-1 text-[11px] text-review-deep">{KIND_LABEL[latest.kind]}</b>
            {withoutSource(latest.text, KIND_LABEL[latest.kind])}
          </>
        ) : (
          <span className="text-pewter">Captions appear here as the shift unfolds.</span>
        )}
      </p>
    )
  }
  if (!latest || media - latest.t > 2.5) return null
  return (
    <div className={cn('pointer-events-none absolute inset-x-3 flex justify-center', small ? 'bottom-14' : 'bottom-16')} aria-live="polite">
      <p className={cn('m-0 max-w-full rounded-lg bg-black/75 px-3 py-1.5 text-center text-white', small ? 'text-[12.5px]' : 'text-[14px]')}>
        <b className="mr-1.5 text-[11px] text-[#ecb240]">{KIND_LABEL[latest.kind]}</b>
        {withoutSource(latest.text, KIND_LABEL[latest.kind])}
      </p>
    </div>
  )
}

interface CameraDockProps {
  variant: 'pip' | 'full' | 'strip'
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
  const small = variant !== 'full'
  const latest = replay.narration[replay.narration.length - 1]

  return (
    <section
      aria-label="Camera 02, recorded replay"
      className={cn('overflow-hidden rounded-[14px] border border-rule bg-white shadow-[var(--shadow-float)]', className)}
      style={style}
    >
      <div className="flex items-center gap-1.5 border-b border-rule px-2 py-1.5">
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
        {variant === 'strip' ? (
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
              {collapsed && latest ? `${KIND_LABEL[latest.kind]}: ${withoutSource(latest.text, KIND_LABEL[latest.kind])}` : `${replay.mediaNow.toFixed(1)} s of ${replay.session.duration_s.toFixed(0)} s`}
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
                Swap
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className={cn('relative bg-black', collapsed && 'h-0 overflow-hidden')}>
        {replay.timeline ? (
          <VideoPanel
            key={replay.session.session_id}
            src={VIDEO_SRC}
            timeline={replay.timeline}
            speed={replay.speed}
            onSpeed={replay.setSpeed}
            playing={replay.playing && !replay.ended}
            onPlaying={replay.setPlaying}
            onTime={replay.onTime}
            onEnded={() => replay.setEnded(true)}
            onRestart={replay.restart}
            timeScale={replay.session.time_scale}
          />
        ) : (
          <div className="grid aspect-video place-items-center text-[13px] text-white/70">Loading the replay</div>
        )}
        {small ? null : <Caption narration={replay.narration} media={replay.mediaNow} />}
        {replay.ended ? (
          <div className="absolute inset-0 grid place-items-center bg-black/65 p-3 text-center text-white">
            <div>
              <p className={cn('m-0 mb-1 font-bold', small ? 'text-[16px]' : 'text-[20px]')}>That was the shift.</p>
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
      {small && !collapsed ? <Caption narration={replay.narration} media={replay.mediaNow} small /> : null}
    </section>
  )
}
