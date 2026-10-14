import { cn } from '@/lib/cn'

/** A table-number stand with a pennant: the TurnWise mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" fill="none" className={cn('size-[26px]', className)} aria-hidden>
      <path d="M7 23h12M13 23V9" stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 3.5v6.5l7-3.2z" fill="var(--color-ready)" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-serif text-[21px] leading-none', className)}>
      <LogoMark />
      TurnWise
    </span>
  )
}
