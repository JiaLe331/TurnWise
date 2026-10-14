import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

interface ContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  title: string
  description?: ReactNode
}

/** Centered dialog on wide screens, bottom sheet on phones. */
export function DialogContent({ title, description, className, children, ...props }: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/30 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-white p-5 shadow-[0_20px_60px_rgb(27_39_51/0.25)] outline-none',
          'inset-x-0 bottom-0 max-h-[92dvh] overflow-auto rounded-t-[18px] pb-[max(20px,env(safe-area-inset-bottom))]',
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(440px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-panel)] sm:pb-5',
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <DialogPrimitive.Title className="m-0 text-lg font-bold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[14px] leading-relaxed text-pewter">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-m-1 grid size-9 place-items-center rounded-lg text-pewter hover:bg-wash"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

interface SheetProps extends ComponentProps<typeof DialogPrimitive.Content> {
  title: string
  side: 'right' | 'bottom'
}

/** Slide-over panel used for the inspector on tablets and phones. */
export function SheetContent({ title, side, className, children, ...props }: SheetProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/20" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden bg-white outline-none shadow-[0_20px_60px_rgb(27_39_51/0.22)]',
          side === 'right' && 'inset-y-3 right-3 w-[min(400px,calc(100vw-24px))] rounded-[var(--radius-panel)] data-[state=open]:animate-[slide-in-right_220ms_ease-out]',
          side === 'bottom' && 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[18px] data-[state=open]:animate-[slide-in-up_220ms_ease-out]',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">Table details and actions</DialogPrimitive.Description>
        {side === 'bottom' ? <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-rule" aria-hidden /> : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
