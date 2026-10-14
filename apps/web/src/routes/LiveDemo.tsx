import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Cctv, ChefHat, LayoutDashboard, Play, RotateCcw, Sparkles, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'wouter'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { demoApi, type DemoSessionInfo, type DemoTimeline } from '@/features/demo/api'
import { hints, type DemoRole, type Hint } from '@/features/demo/guide'
import { HostPanel, useRecommendation } from '@/features/demo/HostPanel'
import { ManagerPanel } from '@/features/demo/ManagerPanel'
import { MIXKIT_AZIMUTH, MIXKIT_LAYOUT, MixkitRoom } from '@/features/demo/mixkitFloor'
import { VideoPanel } from '@/features/demo/VideoPanel'
import { Stage } from '@/features/floor-scene/Stage'
import { Inspector } from '@/features/inspector/Inspector'
import { QueueCards } from '@/features/ledger/QueueCards'
import { BoardProvider, useBoard } from '@/lib/api/board'
import { setApiScope } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { useIdentity } from '@/lib/identity/dev-identity'

const VIDEO_SRC = '/demo-media/mixkit-720p.mp4'
const PERSONA: Record<DemoRole, string> = { host: 'host-1', staff: 'staff-ana', manager: 'manager-1' }
const ROLE_TABS: { role: DemoRole; label: string; icon: typeof UserRound }[] = [
  { role: 'host', label: 'Host', icon: UserRound },
  { role: 'staff', label: 'Floor staff', icon: ChefHat },
  { role: 'manager', label: 'Manager', icon: LayoutDashboard },
]
const TICK_EVERY_S = 0.25 // media seconds between session clock updates

export default function LiveDemo() {
  const [session, setSession] = useState<DemoSessionInfo | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeline = useQuery({ queryKey: ['demo-timeline'], queryFn: demoApi.timeline, staleTime: Infinity })

  const start = useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      const info = await demoApi.start()
      setApiScope({ base: '/api/demo', headers: { 'X-Demo-Session': info.session_id } })
      setSession(info)
    } catch {
      setError('The demo service is not reachable. Start the API and try again.')
    } finally {
      setStarting(false)
    }
  }, [])

  useEffect(() => () => setApiScope({ base: '/api' }), [])

  if (!session || !timeline.data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-linen px-4">
        <div className="max-w-xl text-center">
          <Logo className="mx-auto mb-6" />
          <h1 className="m-0 mb-3 font-serif text-[40px] leading-tight font-normal">Live demo</h1>
          <p className="m-0 mb-2 text-[17px]">
            Watch a real dining-room camera, see TurnWise turn what it sees into table states, and run the shift as
            host, floor staff and manager. Gemini checks tables and briefs the manager.
          </p>
          <p className="m-0 mb-6 text-[14px] text-pewter">
            The footage is a stock time-lapse replayed slowly on a demo clock; walk-in parties are scripted. Every
            action you take runs through the real rules.
          </p>
          <Button tone="primary" size="lg" pending={starting || timeline.isLoading} onClick={start}>
            <Play aria-hidden /> Start live demo
          </Button>
          {error || timeline.isError ? (
            <p className="mt-3 text-[14px] text-clearing-deep">{error ?? 'Could not load the demo timeline.'}</p>
          ) : null}
          <p className="mt-6">
            <Link href="/" className="text-[14px] text-pewter underline">Back to the overview</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <BoardProvider pollMs={1000} key={session.session_id}>
      <Workspace session={session} timeline={timeline.data} onRestart={start} />
    </BoardProvider>
  )
}

function Workspace({ session, timeline, onRestart }: { session: DemoSessionInfo; timeline: DemoTimeline; onRestart: () => void }) {
  const { byId, entries, refetch } = useBoard()
  const { setActorId } = useIdentity()
  const [role, setRole] = useState<DemoRole>('staff')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(0.25)
  const [ended, setEnded] = useState(false)
  const [autoPause, setAutoPause] = useState(true)
  const [fresh, setFresh] = useState<string | null>(null)
  const lastTick = useRef(-1)
  const seen = useRef(new Set<string>())
  const rec = useRecommendation().data
  const { board } = useBoard()
  const waiting = (board?.waitlist ?? []).filter((p) => p.status === 'waiting').length
  const guide = useMemo(() => hints(entries, rec, waiting), [entries, rec, waiting])

  // Pause the replay when the camera or Gemini raises something new, so the viewer can act on it.
  useEffect(() => {
    const novel = guide.find((h) => h.pause && !seen.current.has(h.id))
    for (const h of guide) seen.current.add(h.id)
    if (novel && autoPause) {
      setPlaying(false)
      setFresh(novel.id)
    }
  }, [guide, autoPause])

  useEffect(() => setActorId(PERSONA[role]), [role, setActorId])

  const onTime = useCallback(
    (t: number) => {
      if (t - lastTick.current < TICK_EVERY_S && t < session.duration_s - 0.05) return
      lastTick.current = t
      void demoApi.tick(session.session_id, t).then(refetch, () => undefined)
    },
    [session, refetch],
  )

  const follow = (hint: Hint) => {
    setRole(hint.role)
    if (hint.tableId) setSelectedId(hint.tableId)
  }
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  return (
    <div className="min-h-dvh bg-linen">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule bg-white px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-ink no-underline" aria-label="Back to overview">
          <ArrowLeft className="size-4" aria-hidden />
          <Logo />
        </Link>
        <span className="rounded-lg bg-demo-tint px-2.5 py-1 text-[13px] font-semibold">
          Live demo · time-lapse replay · scripted walk-ins
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-pewter">
          <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} />
          Pause on new events
        </label>
        <nav className="flex rounded-[10px] border border-rule bg-wash p-0.5" aria-label="Acting role">
          {ROLE_TABS.map(({ role: r, label, icon: Icon }) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[14px] font-semibold', role === r ? 'bg-white shadow-sm' : 'text-pewter')}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="space-y-3 p-3">
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="relative">
            <VideoPanel
              key={session.session_id}
              src={VIDEO_SRC}
              timeline={timeline}
              speed={speed}
              onSpeed={setSpeed}
              playing={playing && !ended}
              onPlaying={setPlaying}
              onTime={onTime}
              onEnded={() => setEnded(true)}
              onRestart={onRestart}
              timeScale={session.time_scale}
            />
            {ended ? (
              <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/60 p-4 text-center text-white">
                <div>
                  <p className="m-0 mb-1 text-[20px] font-bold">That was the shift.</p>
                  <p className="m-0 mb-3 text-[14px] text-white/80">Ask Gemini for the briefing and improvements, or run it again.</p>
                  <div className="flex justify-center gap-2">
                    <Button tone="primary" onClick={() => setRole('manager')}>
                      <Sparkles aria-hidden /> Open manager view
                    </Button>
                    <Button tone="secondary" onClick={onRestart}>
                      <RotateCcw aria-hidden /> New shift
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="relative min-h-[320px] overflow-hidden rounded-[14px] border border-rule bg-white">
            <Stage
              lens="status"
              selectedId={selectedId}
              onSelect={setSelectedId}
              layoutOverride={MIXKIT_LAYOUT}
              room={<MixkitRoom />}
              azimuth={MIXKIT_AZIMUTH}
              className="absolute inset-0"
            />
            <span className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-white/90 px-2.5 py-1 text-[12px] font-semibold shadow-sm">
              <Cctv className="size-3.5" aria-hidden /> Floor plan built from {session.camera_name}
            </span>
          </div>
        </div>

        <section aria-label="Guide" className="rounded-[14px] border border-rule bg-white p-3">
          <h2 className="m-0 mb-2 flex items-center gap-2 text-[15px] font-bold">
            <Sparkles className="size-4 text-review" aria-hidden /> What to do next
            <span className="text-[12px] font-normal text-pewter">camera, Gemini and rules suggest; you decide</span>
          </h2>
          {!playing && !ended ? (
            <p className="m-0 mb-2 text-[13px] text-review-deep">
              Replay paused so you can act. Press play on the video when you are ready.
            </p>
          ) : null}
          {guide.length === 0 ? (
            <p className="m-0 text-[14px] text-pewter">All calm. Watch the footage: TurnWise will flag the next handoff.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-3">
              {guide.slice(0, 3).map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => follow(h)}
                    className={cn(
                      'h-full w-full rounded-xl border bg-linen px-3 py-2 text-left hover:border-ink',
                      h.id === fresh ? 'border-review ring-2 ring-review/30' : 'border-rule',
                    )}
                  >
                    <span className="mb-0.5 block text-[11px] font-bold tracking-wide text-pewter uppercase">
                      {h.source === 'gemini' ? 'Gemini' : h.source === 'camera' ? 'Camera' : 'Rules'} · {h.role}
                    </span>
                    <span className="block text-[14px] font-bold">{h.title}</span>
                    <span className="block text-[13px] text-pewter">{h.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={`${role} workspace`} className="rounded-[14px] border border-rule bg-white p-3">
          {role === 'host' ? (
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <HostPanel onSelect={setSelectedId} />
              {selected ? <InspectorBox entryId={selected.table.table_id} onClose={() => setSelectedId(null)} /> : <PickHint />}
            </div>
          ) : role === 'staff' ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <QueueCards selectedId={selectedId} onSelect={setSelectedId} />
              {selected ? <InspectorBox entryId={selected.table.table_id} onClose={() => setSelectedId(null)} /> : <PickHint />}
            </div>
          ) : (
            <ManagerPanel />
          )}
        </section>
      </main>
    </div>
  )
}

function InspectorBox({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { byId } = useBoard()
  const entry = byId.get(entryId)
  if (!entry) return <PickHint />
  return (
    <div className="flex max-h-[520px] min-h-[300px] flex-col overflow-hidden rounded-xl border border-rule">
      <Inspector entry={entry} onClose={onClose} />
    </div>
  )
}

function PickHint() {
  return (
    <p className="m-0 grid min-h-[160px] place-items-center rounded-xl bg-wash px-4 text-center text-[14px] text-pewter">
      Pick a table on the floor, or follow a suggestion above.
    </p>
  )
}
