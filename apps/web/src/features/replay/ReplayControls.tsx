import { Play, UserRound, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'wouter'
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

/** Asks how to run the replay before starting a session. */
export function ReplayStartDialog() {
  const replay = useReplay()
  const [mode, setMode] = useState<DemoMode>('autoplay')
  const [, navigate] = useLocation()
  const open = replay.choosing && !replay.session

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? navigate('/') : undefined)}>
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
