import { Clapperboard, Play, Radio, UserRound, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { DemoMode } from '@/features/demo/api'
import { cn } from '@/lib/cn'
import { useReplay } from './ReplayProvider'

const MODES: { mode: DemoMode; label: string; icon: typeof Play; detail: string }[] = [
  {
    mode: 'autoplay',
    label: 'Autoplay walkthrough',
    icon: Wand2,
    detail: 'Staff and host act on their own, timed to the footage. Captions explain each step.',
  },
  {
    mode: 'guided',
    label: 'Guided, you act',
    icon: UserRound,
    detail: 'The replay pauses on each camera or Gemini event so you can act as host, staff or manager.',
  },
]

/** Header switch between the live outlet and the recorded replay. */
export function SourceSwitch({ compact = false }: { compact?: boolean }) {
  const replay = useReplay()
  const on = Boolean(replay.session)
  return (
    <div role="radiogroup" aria-label="Data source" className="flex rounded-[10px] border border-rule bg-wash p-0.5">
      {(
        [
          [false, 'Live outlet', Radio],
          [true, 'Recorded replay', Clapperboard],
        ] as const
      ).map(([replayOption, label, Icon]) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={on === replayOption}
          aria-label={label}
          onClick={() => (replayOption ? (on ? undefined : replay.openChooser()) : on ? replay.leave() : undefined)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap',
            on === replayOption ? 'bg-white text-ink shadow-sm' : 'text-pewter hover:text-ink',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {compact ? null : label}
        </button>
      ))}
    </div>
  )
}

/**
 * Phone header: one pill that says which data you're looking at and switches source when tapped
 * (there's no room for both a badge and a switch).
 */
export function SourcePill() {
  const replay = useReplay()
  const on = Boolean(replay.session)
  return (
    <button
      type="button"
      onClick={() => (on ? replay.leave() : replay.openChooser())}
      className="demo-stripes inline-flex shrink-0 items-center gap-1.5 rounded-full border border-demo-rule px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap text-demo"
      aria-label={on ? 'Recorded replay. Tap to return to the live outlet' : 'Demo data. Tap to run the recorded replay'}
    >
      {on ? <Clapperboard className="size-3.5" aria-hidden /> : <Radio className="size-3.5" aria-hidden />}
      {on ? 'Replay' : 'Demo'}
    </button>
  )
}

/** Shown while replaying, in place of the demo-data badge: what the viewer is looking at. */
export function ReplayBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="demo-stripes inline-flex items-center gap-1.5 rounded-full border border-demo-rule px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap text-demo"
      title="Stock time-lapse footage replayed on a demo clock; walk-in parties are scripted. Every action runs through the real rules, in a private session."
    >
      <Clapperboard className="size-3.5" aria-hidden />
      {compact ? 'Replay' : 'Recorded replay'}
      <span className="sr-only">
        . Stock time-lapse footage on a demo clock with scripted walk-ins, in a private session.
      </span>
    </span>
  )
}

/** Asks how to run the replay before starting a session. */
export function ReplayStartDialog() {
  const replay = useReplay()
  const [mode, setMode] = useState<DemoMode>('autoplay')
  const open = replay.choosing && !replay.session

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? replay.leave() : undefined)}>
      <DialogContent
        title="Run the recorded replay"
        description="Watch a real dining-room camera and see TurnWise turn it into table states, inside these same host, staff and manager screens. The footage is a stock time-lapse on a demo clock, and walk-ins are scripted. Your actions run through the real rules in a private session."
      >
        <div className="grid gap-2" role="radiogroup" aria-label="Replay mode">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={mode === m.mode}
              onClick={() => setMode(m.mode)}
              className={cn(
                'rounded-xl border-2 bg-white p-3 text-left',
                mode === m.mode ? 'border-ink' : 'border-rule hover:border-pewter',
              )}
            >
              <span className="mb-1 flex items-center gap-2 font-bold">
                <m.icon className="size-4" aria-hidden /> {m.label}
              </span>
              <span className="block text-[13px] text-pewter">{m.detail}</span>
            </button>
          ))}
        </div>
        {replay.error ? <p className="m-0 text-[13.5px] text-clearing-deep">{replay.error}</p> : null}
        <Button tone="primary" size="lg" pending={replay.starting} onClick={() => void replay.start(mode)}>
          <Play aria-hidden />
          Start replay
        </Button>
      </DialogContent>
    </Dialog>
  )
}
