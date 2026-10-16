import { ArrowLeftRight, List, ListChecks, Map as MapIcon, Users } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useSearchParams } from 'wouter'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { PersonaSwitcher } from '@/components/brand/PersonaSwitcher'
import { FreshnessIndicator, OfflineBanner } from '@/components/brand/StatusChrome'
import { Dialog, SheetContent } from '@/components/ui/dialog'
import { Stage } from '@/features/floor-scene/Stage'
import { Inspector } from '@/features/inspector/Inspector'
import { Ledger } from '@/features/ledger/Ledger'
import { QueueCards } from '@/features/ledger/QueueCards'
import { InsightsStrip } from '@/features/insights/InsightsStrip'
import { WaitlistPanel } from '@/features/waitlist/WaitlistPanel'
import type { Hint } from '@/features/demo/guide'
import { CameraDock, RAIL_DOCK_HEIGHT } from '@/features/replay/CameraDock'
import { GuideAutoPause, GuideStrip, ReplayPanel } from '@/features/replay/GuideStrip'
import { ReplayStartDialog } from '@/features/replay/ReplayControls'
import { useReplay } from '@/features/replay/ReplayProvider'
import { REPLAY_PERSONA } from '@/features/replay/replayFloor'
import { useIdentity } from '@/lib/identity/dev-identity'
import { useRecommendation, waitlistOf } from '@/lib/api/seating'
import type { Recommendation } from '@/lib/api/types'
import type { Lens } from '@/features/lenses/lens'
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
  // The floor always shows every table by status; the old lens filters are gone.
  const lens: Lens = 'status'
  const [selectedId, select] = useSelectedTable()
  const { byId } = useBoard()
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null
  const announcement = useSelectedAnnouncement(selectedId)
  const seating = useSeatingView(role)
  const replay = useReplay()
  const inReplay = Boolean(replay.session)
  const { setActorId } = useIdentity()
  const [, navigate] = useLocation()
  const [swapped, setSwapped] = useState(false)

  // In a replay each view acts as that role's person, as the autopilot does.
  useEffect(() => {
    if (inReplay) setActorId(REPLAY_PERSONA[role])
  }, [inReplay, role, setActorId])

  const follow = (hint: Hint) => {
    const query = new URLSearchParams({ source: 'replay', ...(hint.tableId ? { table: hint.tableId } : {}) })
    navigate(`/${hint.role}?${query}`)
  }
  const openManager = () => navigate('/manager?source=replay')
  const replayUi: ReplayUi | null = inReplay ? { swapped, setSwapped, follow } : null

  // The dock is always the first child here, so its video (the demo clock) survives layout changes.
  // Desktop: the top of the right rail, or centred in the floor area when swapped. Tablet: beside the floor.
  const floorL = 16 + panelWidth(role === 'manager') + 16
  const floorR = RAIL + 16
  const dockStyle: CSSProperties | undefined =
    layout === 'desktop'
      ? swapped
        ? ({
            position: 'absolute',
            zIndex: 20,
            // Centred in the floor area below the lens bar; the header and controls add 46px to the 16:9 picture.
            top: 'calc(72px + max(0px, (100% - 88px - (var(--dock-w) * 9 / 16 + 46px)) / 2))',
            // Viewport units, not %, because the variable is also used inside top (where % means height).
            '--dock-w': `min(calc(100vw - ${floorL + floorR}px), calc((100dvh - 196px) * 16 / 9))`,
            width: 'var(--dock-w)',
            left: `calc(${floorL}px + (100vw - ${floorL + floorR}px - var(--dock-w)) / 2)`,
          } as CSSProperties)
        : { position: 'absolute', zIndex: 20, top: 16, right: 16, width: RAIL - 16 }
      : layout === 'tablet'
        ? { position: 'absolute', zIndex: 20, top: 12, right: 12, width: TABLET_RAIL - 12, height: TABLET_DOCK_HEIGHT }
        : undefined

  return (
    <div className="fixed inset-0 flex flex-col bg-linen">
      <AppHeader role={role} layout={layout} inReplay={inReplay} />
      <OfflineBanner />
      <ReplayStartDialog />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CameraDock
          variant={layout === 'phone' ? 'strip' : swapped && layout === 'desktop' ? 'full' : 'rail'}
          style={dockStyle}
          className={layout === 'phone' ? 'mx-2 mt-2 shrink-0' : undefined}
          onSwap={layout === 'desktop' ? () => setSwapped((v) => !v) : undefined}
          onOpenManager={openManager}
        />
        {inReplay ? <GuideAutoPause /> : null}
        {layout === 'phone' && replayUi ? <GuideStrip onFollow={follow} className="mx-2 mt-2 shrink-0" /> : null}
        {layout === 'desktop' ? (
          <DesktopFloor lens={lens} selected={selected} select={select} seating={seating} shift={role === 'manager'} replay={replayUi} />
        ) : layout === 'tablet' ? (
          <TabletFloor lens={lens} selected={selected} select={select} seating={seating} shift={role === 'manager'} replay={replayUi} />
        ) : (
          <PhoneFloor role={role} lens={lens} selected={selected} select={select} seating={seating} shift={role === 'manager'} replay={replayUi} />
        )}
      </div>
    </div>
  )
}

interface ReplayUi {
  swapped: boolean
  setSwapped: (swapped: boolean) => void
  follow: (hint: Hint) => void
}

/** Desktop left panel width: wider for the manager, whose panel holds the assistant chat. */
const panelWidth = (manager: boolean) => (manager ? 360 : 296)
/** Desktop: the replay rail's width plus its margin. */
const RAIL = 16 + 400
/** Tablet: the replay column beside the floor. */
const TABLET_RAIL = 12 + 320
const TABLET_DOCK_HEIGHT = 316

interface FloorProps {
  lens: Lens
  selected: ReturnType<typeof useBoard>['entries'][number] | null
  select: (id: string | null) => void
  /** Waitlist and seating state; null on views that don't seat parties. */
  seating: SeatingView | null
  /** The manager view: assistant tab and insights strip. */
  shift: boolean
  /** Replay extras (guide strip, swapped camera); null on the live outlet. */
  replay: ReplayUi | null
}

type ListTab = 'waitlist' | 'tables' | 'assistant'

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
  const firstTab: ListTab = role === 'host' ? 'waitlist' : role === 'manager' ? 'assistant' : 'tables'
  const [tab, setTab] = useState<ListTab>(firstTab)
  const [partyId, setPartyId] = useState<string | null>(null)
  const waitlist = waitlistOf(board)
  // A seated or removed party can't stay selected.
  const activeParty = partyId && waitlist.some((p) => p.party_id === partyId && p.status === 'waiting') ? partyId : null
  const query = useRecommendation(activeParty, seats && waitlist.length > 0)

  useEffect(() => setTab(firstTab), [firstTab])

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
  assistantTab = false,
  className,
}: {
  lens: Lens
  seating: SeatingView | null
  selectedId: string | null
  onSelect: (id: string) => void
  /** Adds the Assistant tab (manager view). */
  assistantTab?: boolean
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
            ...(assistantTab ? ([['assistant', 'Assistant']] as const) : []),
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
      ) : seating.tab === 'assistant' && assistantTab ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <Ledger lens={lens} selectedId={selectedId} onSelect={onSelect} className="min-h-0 flex-1" />
      )}
    </div>
  )
}

const PHONE_LABEL: Record<RouteRole, string> = { host: 'Host', staff: 'Staff', manager: 'Manager' }

const NAV: { role: RouteRole; href: string }[] = [
  { role: 'manager', href: '/manager' },
  { role: 'host', href: '/host' },
  { role: 'staff', href: '/staff' },
]

function AppHeader({ role, layout, inReplay }: { role: RouteRole; layout: ReturnType<typeof useLayout>; inReplay: boolean }) {
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
            href={inReplay ? `${item.href}?source=replay` : item.href}
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
      {phone ? null : <FreshnessIndicator />}
      <PersonaSwitcher compact={layout !== 'desktop'} />
    </header>
  )
}

const PANEL = 'rounded-[var(--radius-panel)] border border-rule bg-white shadow-[var(--shadow-float)]'

function DesktopFloor({ lens, selected, select, seating, shift, replay }: FloorProps) {
  const left = 16 + panelWidth(shift)
  // The right side holds the replay rail, or the inspector.
  const right = replay ? RAIL : selected ? 16 + 372 : 0
  // A next step being hovered points at its table on the floor.
  const [pointed, setPointed] = useState<string | null>(null)
  const spotlight = pointed ? [pointed] : seating?.spotlight
  const swapped = Boolean(replay?.swapped)
  return (
    <div className="relative min-h-0 flex-1">
      {/* Swapped during a replay, the floor takes the camera's place at the top of the rail. */}
      <div
        className={cn(
          swapped
            ? 'absolute top-4 right-4 z-20 overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-linen shadow-[var(--shadow-float)]'
            : 'absolute inset-0',
        )}
        style={swapped ? { width: RAIL - 16, height: RAIL_DOCK_HEIGHT } : undefined}
      >
        <Stage
          className="absolute inset-0"
          lens={lens}
          selectedId={selected?.table.table_id ?? null}
          onSelect={select}
          insets={swapped ? { top: 44, bottom: 8 } : { left, right, top: 64, bottom: 56 }}
          compact={swapped}
          spotlight={spotlight}
        />
        {swapped ? (
          <button
            type="button"
            onClick={() => replay?.setSwapped(false)}
            className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-rule bg-white px-2 py-1 text-[12.5px] font-semibold text-ink shadow-sm hover:bg-wash"
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
            Floor large
          </button>
        ) : null}
      </div>
      <aside className={cn(PANEL, 'absolute top-4 bottom-4 left-4 z-10 flex flex-col overflow-hidden')} style={{ width: panelWidth(shift) }}>
        <SideList lens={lens} seating={seating} selectedId={selected?.table.table_id ?? null} onSelect={select} assistantTab={shift} className="min-h-0 flex-1" />
      </aside>
      {shift ? (
        <div
          className="absolute top-4 z-10 -translate-x-1/2"
          style={{ left: `calc(${left}px + (100% - ${left + right}px) / 2)`, maxWidth: `calc(100% - ${left + right}px - 32px)` }}
        >
          <InsightsStrip />
        </div>
      ) : null}
      {replay ? (
        // Under the camera: the inspector for a selected table, otherwise next steps.
        <aside
          className={cn(PANEL, 'absolute right-4 bottom-4 z-10 flex flex-col overflow-hidden')}
          style={{ top: 16 + RAIL_DOCK_HEIGHT + 12, width: RAIL - 16 }}
        >
          {selected ? (
            <Inspector entry={selected} onClose={() => select(null)} />
          ) : (
            <ReplayPanel onFollow={replay.follow} onPoint={setPointed} />
          )}
        </aside>
      ) : selected ? (
        <aside
          className={cn(PANEL, 'absolute top-4 right-4 bottom-4 z-10 flex w-[372px] flex-col overflow-hidden animate-[slide-in-right_200ms_ease-out]')}
        >
          <Inspector entry={selected} onClose={() => select(null)} />
        </aside>
      ) : null}
    </div>
  )
}

function TabletFloor({ lens, selected, select, seating, shift, replay }: FloorProps) {
  const landscape = useMediaQuery('(orientation: landscape)')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* In a replay the camera and next step sit in a column beside the floor, so the top grows to fit them. */}
      <div className={cn('relative shrink-0 border-b border-rule', replay ? 'h-[max(55%,470px)]' : 'h-[55%]')}>
        <Stage
          className="absolute inset-0"
          lens={lens}
          selectedId={selected?.table.table_id ?? null}
          onSelect={select}
          insets={{ top: 60, bottom: 40, right: replay ? TABLET_RAIL : 0 }}
          spotlight={seating?.spotlight}
        />
        {replay ? (
          <div className="absolute right-3 z-10" style={{ top: 12 + TABLET_DOCK_HEIGHT + 8, width: TABLET_RAIL - 12 }}>
            <GuideStrip onFollow={replay.follow} />
          </div>
        ) : null}
        {shift ? (
          <div
            className="absolute top-3 z-10 -translate-x-1/2"
            style={{ left: `calc((100% - ${replay ? TABLET_RAIL : 0}px) / 2)`, maxWidth: `calc(100% - ${replay ? TABLET_RAIL : 0}px - 24px)` }}
          >
            <InsightsStrip />
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 bg-white">
        <SideList lens={lens} seating={seating} selectedId={selected?.table.table_id ?? null} onSelect={select} assistantTab={shift} className="h-full" />
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

function PhoneFloor({ role, lens, selected, select, seating, shift }: FloorProps & { role: RouteRole }) {
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
              </div>
              <div className="px-4 pt-3.5 pb-6">
                <QueueCards selectedId={selected?.table.table_id ?? null} onSelect={select} />
              </div>
            </>
          ) : (
            <SideList lens={lens} seating={seating} selectedId={selected?.table.table_id ?? null} onSelect={openSheet} assistantTab={shift} className="min-h-full bg-white" />
          )}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <Stage className="absolute inset-0" lens={lens} selectedId={selected?.table.table_id ?? null} onSelect={openSheet} insets={{ top: 56, bottom: 40 }} spotlight={seating?.spotlight} />
          {shift ? (
            <div className="absolute top-2.5 right-2.5 left-2.5 z-10">
              <InsightsStrip />
            </div>
          ) : null}
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
