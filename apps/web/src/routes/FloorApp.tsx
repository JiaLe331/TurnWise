import { Info, List, ListChecks, Map as MapIcon, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'wouter'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { PersonaSwitcher } from '@/components/brand/PersonaSwitcher'
import { DataModeBadge, FreshnessIndicator, OfflineBanner } from '@/components/brand/StatusChrome'
import { Dialog, SheetContent } from '@/components/ui/dialog'
import { useFloorModel } from '@/features/floor-scene/floorModel'
import { Stage } from '@/features/floor-scene/Stage'
import { Inspector } from '@/features/inspector/Inspector'
import { Ledger } from '@/features/ledger/Ledger'
import { QueueCards } from '@/features/ledger/QueueCards'
import { ShiftOverview } from '@/features/manager/ShiftOverview'
import { WaitlistPanel } from '@/features/waitlist/WaitlistPanel'
import { useRecommendation, waitlistOf } from '@/lib/api/seating'
import type { Recommendation } from '@/lib/api/types'
import { DEFAULT_LENS, LensSwitch, type Lens } from '@/features/lenses/lens'
import { useBoard } from '@/lib/api/board'
import type { UserRole } from '@/lib/api/types'
import { cn } from '@/lib/cn'
import { ROLE_LABEL } from '@/lib/domain/permissions'
import { STATE } from '@/lib/domain/status'
import { useLayout, useMediaQuery } from '@/lib/use-media'

export type RouteRole = 'host' | 'staff' | 'manager'

const ROUTE_ROLE: Record<RouteRole, UserRole> = { host: 'host', staff: 'floor_staff', manager: 'manager' }

function useSelectedTable(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const selected = params.get('table')
  const select = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('table', id)
        else next.delete('table')
        return next
      },
      { replace: true },
    )
  return [selected, select]
}

/** Announces state changes on the selected table to screen readers. */
function useSelectedAnnouncement(selectedId: string | null): string {
  const { byId } = useBoard()
  const entry = selectedId ? byId.get(selectedId) : undefined
  const state = entry?.session.operational_state
  const previous = useRef<{ id: string | null; state?: string }>({ id: null })
  const [message, setMessage] = useState('')
  useEffect(() => {
    const prev = previous.current
    if (prev.id === selectedId && prev.state && state && prev.state !== state) {
      setMessage(`${selectedId} is now ${STATE[state].label.toLowerCase()}`)
    }
    previous.current = { id: selectedId, state }
  }, [selectedId, state])
  return message
}

export function FloorApp({ role }: { role: RouteRole }) {
  const layout = useLayout()
  const [lens, setLens] = useState<Lens>(DEFAULT_LENS[ROUTE_ROLE[role]])
  const [selectedId, select] = useSelectedTable()
  const { byId } = useBoard()
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null
  const announcement = useSelectedAnnouncement(selectedId)
  const seating = useSeatingView(role)

  useEffect(() => setLens(DEFAULT_LENS[ROUTE_ROLE[role]]), [role])

  return (
    <div className="fixed inset-0 flex flex-col bg-linen">
      <AppHeader role={role} layout={layout} />
      <OfflineBanner />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {layout === 'desktop' ? (
        <DesktopFloor lens={lens} setLens={setLens} selected={selected} select={select} seating={seating} shift={role === 'manager'} />
      ) : layout === 'tablet' ? (
        <TabletFloor lens={lens} setLens={setLens} selected={selected} select={select} seating={seating} shift={role === 'manager'} />
      ) : (
        <PhoneFloor role={role} lens={lens} setLens={setLens} selected={selected} select={select} seating={seating} shift={role === 'manager'} />
      )}
    </div>
  )
}

interface FloorProps {
  lens: Lens
  setLens: (lens: Lens) => void
  selected: ReturnType<typeof useBoard>['entries'][number] | null
  select: (id: string | null) => void
  /** Waitlist and seating state; null on views that don't seat parties. */
  seating: SeatingView | null
  /** The manager view shows the shift overview. */
  shift: boolean
}

type ListTab = 'waitlist' | 'tables' | 'shift'

interface SeatingView {
  tab: ListTab
  setTab: (tab: ListTab) => void
  rec: Recommendation | undefined
  recLoading: boolean
  partyId: string | null
  setPartyId: (id: string | null) => void
  waiting: number
  /** Suggested tables to highlight on the floor, best first. */
  spotlight: string[] | undefined
}

/** Hosts and managers seat parties, so their views get the waitlist and seating suggestions. */
function useSeatingView(role: RouteRole): SeatingView | null {
  const seats = role === 'host' || role === 'manager'
  const { board } = useBoard()
  const [tab, setTab] = useState<ListTab>(role === 'host' ? 'waitlist' : 'tables')
  const [partyId, setPartyId] = useState<string | null>(null)
  const waitlist = waitlistOf(board)
  // A seated or removed party can't stay selected.
  const activeParty = partyId && waitlist.some((p) => p.party_id === partyId && p.status === 'waiting') ? partyId : null
  const query = useRecommendation(activeParty, seats && waitlist.length > 0)

  useEffect(() => setTab(role === 'host' ? 'waitlist' : 'tables'), [role])

  if (!seats) return null
  const rec = waitlist.length > 0 ? query.data : undefined
  return {
    tab,
    setTab,
    rec,
    recLoading: query.isLoading,
    partyId: activeParty,
    setPartyId,
    waiting: waitlist.length,
    spotlight: tab === 'waitlist' && rec?.party && rec.tables.length ? rec.tables.map((t) => t.table_id) : undefined,
  }
}

/** The left panel: the plain table list, or Waitlist and Tables tabs for views that seat parties. */
function SideList({
  lens,
  seating,
  selectedId,
  onSelect,
  shiftTab = false,
  className,
}: {
  lens: Lens
  seating: SeatingView | null
  selectedId: string | null
  onSelect: (id: string) => void
  /** Adds a Shift tab (manager on tablet and phone, where there's no right column). */
  shiftTab?: boolean
  className?: string
}) {
  if (!seating) return <Ledger lens={lens} selectedId={selectedId} onSelect={onSelect} className={className} />
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div role="tablist" aria-label="List" className="flex shrink-0 gap-1 border-b border-rule px-3 pt-3">
        {(
          [
            ['waitlist', 'Waitlist'],
            ['tables', 'Tables'],
            ...(shiftTab ? ([['shift', 'Shift']] as const) : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={seating.tab === id}
            onClick={() => seating.setTab(id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-[15px] font-semibold',
              seating.tab === id ? 'border-ink text-ink' : 'border-transparent text-pewter hover:text-ink',
            )}
          >
            {label}
            {id === 'waitlist' && seating.waiting > 0 ? (
              <span className="tabular rounded-full bg-ink px-1.5 text-[11.5px] font-bold text-white">{seating.waiting}</span>
            ) : null}
          </button>
        ))}
      </div>
      {seating.tab === 'waitlist' ? (
        <WaitlistPanel
          rec={seating.rec}
          recLoading={seating.recLoading}
          selectedPartyId={seating.partyId}
          onSelectParty={seating.setPartyId}
          onSelectTable={onSelect}
          className="min-h-0 flex-1"
        />
      ) : seating.tab === 'shift' && shiftTab ? (
        <ShiftOverview className="min-h-0 flex-1" />
      ) : (
        <Ledger lens={lens} selectedId={selectedId} onSelect={onSelect} className="min-h-0 flex-1" />
      )}
    </div>
  )
}

const PHONE_LABEL: Record<RouteRole, string> = { host: 'Host', staff: 'Staff', manager: 'Manager' }

const NAV: { role: RouteRole; href: string }[] = [
  { role: 'host', href: '/host' },
  { role: 'staff', href: '/staff' },
  { role: 'manager', href: '/manager' },
]

function AppHeader({ role, layout }: { role: RouteRole; layout: ReturnType<typeof useLayout> }) {
  const phone = layout === 'phone'
  return (
    <header className="z-10 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-white px-4 sm:h-[60px] sm:gap-4 sm:px-5">
      <Link href="/" aria-label="TurnWise home" className="text-ink no-underline">
        {phone ? <LogoMark /> : <Logo />}
      </Link>
      <nav aria-label="Views" className={cn('flex gap-1', !phone && 'ml-2')}>
        {NAV.map((item) => (
          <Link
            key={item.role}
            href={item.href}
            aria-current={item.role === role ? 'page' : undefined}
            className={cn(
              'rounded-lg px-2.5 py-2 text-[14px] font-semibold text-pewter no-underline hover:text-ink sm:px-3 sm:text-[15px]',
              item.role === role && 'bg-wash text-ink',
            )}
          >
            {phone ? PHONE_LABEL[item.role] : ROLE_LABEL[ROUTE_ROLE[item.role]]}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <DataModeBadge compact={phone} />
      {phone ? null : <FreshnessIndicator />}
      <PersonaSwitcher compact={layout !== 'desktop'} />
    </header>
  )
}

function IllustrativeNote({ className }: { className?: string }) {
  const { note } = useFloorModel()
  return (
    <p
      className={cn(
        'pointer-events-none m-0 flex items-center gap-2 rounded-[9px] border border-rule bg-white/90 px-3 py-1.5 text-[13px] font-medium text-pewter',
        className,
      )}
    >
      <Info className="size-4 shrink-0" aria-hidden />
      {note}
    </p>
  )
}

const PANEL = 'rounded-[var(--radius-panel)] border border-rule bg-white shadow-[var(--shadow-float)]'

function DesktopFloor({ lens, setLens, selected, select, seating, shift }: FloorProps) {
  const left = 16 + 296
  // The manager's right column always holds something: the inspector, or the shift overview.
  const right = selected || shift ? 16 + 372 : 0
  return (
    <div className="relative min-h-0 flex-1">
      <Stage
        className="absolute inset-0"
        lens={lens}
        selectedId={selected?.table.table_id ?? null}
        onSelect={select}
        insets={{ left, right, top: 64, bottom: 56 }}
        spotlight={seating?.spotlight}
      />
      <aside className={cn(PANEL, 'absolute top-4 bottom-4 left-4 z-10 flex w-[296px] flex-col overflow-hidden')}>
        <SideList lens={lens} seating={seating} selectedId={selected?.table.table_id ?? null} onSelect={select} className="min-h-0 flex-1" />
      </aside>
      <div
        className="absolute top-4 z-10 -translate-x-1/2"
        style={{ left: `calc(${left}px + (100% - ${left + right}px) / 2)` }}
      >
        <LensSwitch lens={lens} onChange={setLens} />
      </div>
      {/* Bottom-left of the free floor area, leaving the bottom-right for the floor view switch. */}
      <div
        className="pointer-events-none absolute bottom-4 z-10"
        style={{ left: left + 16, maxWidth: `calc(100% - ${left + right}px - 260px)` }}
      >
        <IllustrativeNote />
      </div>
      {selected ? (
        <aside
          className={cn(PANEL, 'absolute top-4 right-4 bottom-4 z-10 flex w-[372px] flex-col overflow-hidden animate-[slide-in-right_200ms_ease-out]')}
        >
          <Inspector entry={selected} onClose={() => select(null)} />
        </aside>
      ) : shift ? (
        <aside className={cn(PANEL, 'absolute top-4 right-4 bottom-4 z-10 flex w-[372px] flex-col overflow-hidden')}>
          <ShiftOverview className="min-h-0 flex-1" />
        </aside>
      ) : null}
    </div>
  )
}

function TabletFloor({ lens, setLens, selected, select, seating, shift }: FloorProps) {
  const landscape = useMediaQuery('(orientation: landscape)')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative h-[55%] shrink-0 border-b border-rule">
        <Stage className="absolute inset-0" lens={lens} selectedId={selected?.table.table_id ?? null} onSelect={select} insets={{ top: 60, bottom: 40 }} spotlight={seating?.spotlight} />
        <div className="absolute top-3 left-1/2 z-10 max-w-[calc(100%-24px)] -translate-x-1/2">
          <LensSwitch lens={lens} onChange={setLens} />
        </div>
        <IllustrativeNote className="absolute bottom-3 left-3 z-10 text-[12px]" />
      </div>
      <div className="min-h-0 flex-1 bg-white">
        <SideList lens={lens} seating={seating} selectedId={selected?.table.table_id ?? null} onSelect={select} shiftTab={shift} className="h-full" />
      </div>
      <InspectorSheet selected={selected} select={select} side={landscape ? 'right' : 'bottom'} />
    </div>
  )
}

function InspectorSheet({ selected, select, side }: Pick<FloorProps, 'selected' | 'select'> & { side: 'right' | 'bottom' }) {
  return (
    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && select(null)}>
      {selected ? (
        <SheetContent side={side} title={`Table ${selected.table.table_id}`}>
          <Inspector entry={selected} onClose={() => select(null)} />
        </SheetContent>
      ) : null}
    </Dialog>
  )
}

function PhoneFloor({ role, lens, setLens, selected, select, seating, shift }: FloorProps & { role: RouteRole }) {
  const [tab, setTab] = useState<'list' | 'floor'>('list')
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const staff = role === 'staff'
  const openSheet = (id: string | null) => {
    select(id)
    setSheetFor(id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tab === 'list' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {staff ? (
            <>
              <div className="relative h-[200px] border-b border-rule">
                <Stage
                  className="absolute inset-0"
                  lens="clearing"
                  compact
                  selectedId={selected?.table.table_id ?? null}
                  onSelect={select}
                />
                <p className="pointer-events-none absolute bottom-2 left-2.5 z-10 m-0 rounded-md bg-white/85 px-2 py-0.5 text-[11.5px] font-medium text-pewter">
                  Illustrative layout
                </p>
              </div>
              <div className="px-4 pt-3.5 pb-6">
                <QueueCards selectedId={selected?.table.table_id ?? null} onSelect={select} />
              </div>
            </>
          ) : (
            <SideList lens={lens} seating={seating} selectedId={selected?.table.table_id ?? null} onSelect={openSheet} shiftTab={shift} className="min-h-full bg-white" />
          )}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <Stage className="absolute inset-0" lens={lens} selectedId={selected?.table.table_id ?? null} onSelect={openSheet} insets={{ top: 56, bottom: 40 }} spotlight={seating?.spotlight} />
          <div className="absolute top-2.5 right-2.5 left-2.5 z-10">
            <LensSwitch lens={lens} onChange={setLens} />
          </div>
          <p className="pointer-events-none absolute bottom-2 left-2.5 z-10 m-0 rounded-md bg-white/85 px-2 py-0.5 text-[11.5px] font-medium text-pewter">
            Illustrative layout
          </p>
        </div>
      )}
      <nav aria-label="Phone views" className="flex h-16 shrink-0 border-t border-rule bg-white pb-[env(safe-area-inset-bottom)]">
        {[
          { id: 'list' as const, label: staff ? 'Queue' : role === 'host' ? 'Waitlist' : 'Tables', icon: staff ? ListChecks : role === 'host' ? Users : List },
          { id: 'floor' as const, label: 'Floor', icon: MapIcon },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold text-pewter', tab === id && 'text-ink')}
          >
            <Icon className="size-[22px]" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      <InspectorSheet
        selected={sheetFor && selected?.table.table_id === sheetFor ? selected : null}
        select={(id) => openSheet(id)}
        side="bottom"
      />
    </div>
  )
}
