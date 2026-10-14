import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-bold whitespace-nowrap transition-colors disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        primary: 'bg-ink text-white hover:bg-[#2a3a49]',
        ready: 'bg-ready text-white hover:bg-[#256a43]',
        secondary: 'border border-[#c9d0ca] bg-white text-ink hover:bg-wash',
        danger: 'border border-clearing/50 bg-white text-clearing-deep hover:bg-clearing-tint',
        ghost: 'text-ink hover:bg-wash',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[15px]',
        lg: 'h-[52px] px-5 text-base',
        xl: 'h-14 px-5 text-[17px]',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { tone: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  pending?: boolean
}

export function Button({ className, tone, size, block, pending, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ tone, size, block }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
