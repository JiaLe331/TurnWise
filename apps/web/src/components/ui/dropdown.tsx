import { DropdownMenu as Menu } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const Dropdown = Menu.Root
export const DropdownTrigger = Menu.Trigger
export const DropdownLabel = Menu.Label
export const DropdownRadioGroup = Menu.RadioGroup

export function DropdownContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={6}
        align="end"
        className={cn(
          'z-50 min-w-[220px] rounded-xl border border-rule bg-white p-1.5 shadow-[var(--shadow-float)]',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownRadioItem({ className, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-semibold outline-none data-[highlighted]:bg-wash data-[state=checked]:bg-wash',
        className,
      )}
      {...props}
    />
  )
}
