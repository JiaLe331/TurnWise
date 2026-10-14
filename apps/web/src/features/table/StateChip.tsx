import type { OperationalState } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { STATE } from '@/lib/domain/status'

export function StateChip({ state, className }: { state: OperationalState; className?: string }) {
  const s = STATE[state]
  const Icon = s.icon
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-bold', className)}
      style={{ background: s.tint, color: s.deep }}
    >
      <Icon className="size-4" style={{ color: s.solid }} aria-hidden />
      {s.label}
    </span>
  )
}
