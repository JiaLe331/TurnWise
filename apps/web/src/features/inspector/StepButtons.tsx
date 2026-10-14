import { CircleCheck, DoorOpen, Hand, Play, Undo2, Users } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { actionId, useActions } from '@/lib/api/board'
import type { Step } from '@/lib/domain/next-step'

const ICONS: Partial<Record<string, typeof Hand>> = {
  Claim: Hand,
  'Start cleaning': Play,
  'Mark ready': CircleCheck,
  'Release task': Undo2,
  'Confirm departure': DoorOpen,
  'Keep seated': Users,
  'Ask for a departure check': DoorOpen,
}

interface StepButtonProps {
  step: Step
  size?: 'md' | 'lg' | 'xl'
  block?: boolean
  className?: string
}

/** One workflow action. Steps with `confirm` take a second tap in a dialog before anything is sent. */
export function StepButton({ step, size = 'lg', block, className }: StepButtonProps) {
  const { run, pending, paused } = useActions()
  const [confirming, setConfirming] = useState(false)
  const Icon = ICONS[step.label]
  const isPending = pending === actionId(step.input)
  const tone = step.tone === 'secondary' ? 'secondary' : step.tone

  const send = () =>
    run(step.input, { success: step.success, onSuccess: () => setConfirming(false) })

  return (
    <>
      <Button
        tone={tone}
        size={size}
        block={block}
        className={className}
        disabled={paused}
        pending={isPending && !confirming}
        onClick={() => (step.confirm ? setConfirming(true) : send())}
      >
        {Icon && !isPending ? <Icon aria-hidden /> : null}
        {step.label}
      </Button>
      {step.confirm ? (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent title={`${step.label}?`} description={step.confirm}>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button tone="primary" size="lg" className="flex-1" pending={isPending} disabled={paused} onClick={send}>
                {step.label}
              </Button>
              <Button size="lg" className="flex-1" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
