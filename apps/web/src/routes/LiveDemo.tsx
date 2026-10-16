import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Box, Cctv, ChefHat, LayoutDashboard, Map as MapIcon, Play, RotateCcw, Sparkles, UserRound, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'wouter'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { demoApi, type DemoMode, type DemoSessionInfo, type DemoTimeline, type Narration } from '@/features/demo/api'
import { HostFloorPlan } from '@/features/demo/HostFloorPlan'
import { hints, type DemoRole, type Hint } from '@/features/demo/guide'
import { HostPanel, useRecommendation } from '@/features/demo/HostPanel'
import { ManagerPanel } from '@/features/demo/ManagerPanel'
import { MIXKIT_AZIMUTH, MIXKIT_LAYOUT, MixkitRoom } from '@/features/demo/mixkitFloor'
import { VideoPanel } from '@/features/demo/VideoPanel'
import { Stage } from '@/features/floor-scene/Stage'
import { Inspector } from '@/features/inspector/Inspector'
import { QueueCards } from '@/features/ledger/QueueCards'
import { BoardProvider, useBoard } from '@/lib/api/board'
import { API_BASE, DEMO_VIDEO_SRC } from '@/config'
import { setApiScope } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { useIdentity } from '@/lib/identity/dev-identity'

const PERSONA: Record<DemoRole, string> = { host: 'host-1', staff: 'staff-ana', manager: 'manager-1' }
const ROLE_TABS: { role: DemoRole; label: string; icon: typeof UserRound }[] = [
  { role: 'host', label: 'Host', icon: UserRound },
  { role: 'staff', label: 'Floor staff', icon: ChefHat },
  { role: 'manager', label: 'Manager', icon: LayoutDashboard },
]
const TICK_EVERY_S = 0.25 // media seconds between session clock updates
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

export default function LiveDemo() {
  const [session, setSession] = useState<DemoSessionInfo | null>(null)
  const [mode, setMode] = useState<DemoMode>('autoplay')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeline = useQuery({ queryKey: ['demo-timeline'], queryFn: demoApi.timeline, staleTime: Infinity })

  const start = useCallback(async (chosen: DemoMode) => {
    setStarting(true)
    setError(null)
    try {
      const info = await demoApi.start(chosen)
      setApiScope({ base: `${API_BASE}/demo`, headers: { 'X-Demo-Session': info.session_id } })
      setSession(info)
    } catch {
      setError('The demo service is not reachable. Start the API and try again.')
    } finally {
      setStarting(false)
    }
  }, [])

  useEffect(() => () => setApiScope({ base: API_BASE }), [])

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
          <div className="mb-5 grid gap-2 text-left sm:grid-cols-2" role="radiogroup" aria-label="Demo mode">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                onClick={() => setMode(m.mode)}
                className={cn(
                  'rounded-xl border-2 bg-white p-3',
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
          <Button tone="primary" size="lg" pending={starting || timeline.isLoading} onClick={() => start(mode)}>
            <Play aria-hidden /> Start live demo
          </Button>
          {error || timeline.isError ? (
            <p className="mt-3 text-[14px] text-clearing-deep">{error ?? 'Could not load the demo timeline.'}</p>
          ) : null}
          <p className="mt-6 text-[14px] text-pewter">
            This is the original demo page. The replay now runs inside the main app:{' '}
            <Link href="/host?source=replay" className="font-semibold text-ink underline">open it there</Link>.
          </p>
          <p className="mt-2">
            <Link href="/" className="text-[14px] text-pewter underline">Back to the overview</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <BoardProvider pollMs={1000} key={session.session_id}>
      <Workspace session={session} timeline={timeline.data} onRestart={(m) => start(m)} />
    </BoardProvider>
  )
}

function Workspace({
  session,
  timeline,
  onRestart,
}: {
  session: DemoSessionInfo
  timeline: DemoTimeline
  onRestart: (mode: DemoMode) => void
}) {
  const { byId, entries, refetch } = useBoard()
  const { setActorId } = useIdentity()
  const [role, setRole] = useState<DemoRole>('staff')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(0.25)
  const [ended, setEnded] = useState(false)
  const [mode, setMode] = useState<DemoMode>(session.mode)
  const autoPause = mode === 'guided'
  const [floor, setFloor] = useState<'3d' | 'plan'>('3d')
  const [narration, setNarration] = useState<Narration[]>([])
  const [simNow, setSimNow] = useState<string | null>(null)
  const [mediaNow, setMediaNow] = useState(0)
  const [fresh, setFresh] = useState<string | null>(null)
  const lastTick = useRef(-1)
  const seen = useRef(new Set<string>())
  const rec = useRecommendation().data
  const guide = useMemo(() => hints(entries, rec), [entries, rec])

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
      setMediaNow(t)
      void demoApi.tick(session.session_id, t).then((r) => {
        setNarration(r.narration)
        setSimNow(r.sim_now)
        refetch()
      }, () => undefined)
    },
    [session, refetch],
  )

  const changeMode = (next: DemoMode) => {
    setMode(next)
    if (next === 'autoplay') setPlaying(true)
    void demoApi.setMode(session.session_id, next).then((r) => setNarration(r.narration), () => undefined)
  }

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
        <div className="ml-auto flex rounded-[10px] border border-rule bg-wash p-0.5" role="group" aria-label="Demo mode">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => changeMode(m.mode)}
              aria-pressed={mode === m.mode}
              className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold', mode === m.mode ? 'bg-white shadow-sm' : 'text-pewter')}
            >
              <m.icon className="size-4" aria-hidden />
              {m.mode === 'autoplay' ? 'Autoplay' : 'Guided'}
            </button>
          ))}
        </div>
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
              src={DEMO_VIDEO_SRC}
              timeline={timeline}
              speed={speed}
              onSpeed={setSpeed}
              playing={playing && !ended}
              onPlaying={setPlaying}
              onTime={onTime}
              onEnded={() => setEnded(true)}
              onRestart={() => onRestart(mode)}
              timeScale={session.time_scale}
            />
            <Caption narration={narration} media={mediaNow} />
            {ended ? (
              <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/60 p-4 text-center text-white">
                <div>
                  <p className="m-0 mb-1 text-[20px] font-bold">That was the shift.</p>
                  <p className="m-0 mb-3 text-[14px] text-white/80">Ask Gemini for the briefing and improvements, or run it again.</p>
                  <div className="flex justify-center gap-2">
                    <Button tone="primary" onClick={() => setRole('manager')}>
                      <Sparkles aria-hidden /> Open manager view
                    </Button>
                    <Button tone="secondary" onClick={() => onRestart(mode)}>
                      <RotateCcw aria-hidden /> New shift
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="relative min-h-[360px] overflow-hidden rounded-[14px] border border-rule bg-white">
            {floor === '3d' ? (
              <>
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
              </>
            ) : (
              <div className="absolute inset-0 bg-linen">
                <HostFloorPlan selectedId={selectedId} onSelect={setSelectedId} simNow={simNow} />
              </div>
            )}
            <div className="absolute bottom-3 left-3 z-20 flex rounded-[9px] border border-rule bg-white p-0.5 shadow-sm" role="group" aria-label="Floor view">
              {(
                [
                  ['3d', '3D', Box],
                  ['plan', 'Host plan', MapIcon],
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFloor(v)}
                  aria-pressed={floor === v}
                  className={cn('flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold', floor === v ? 'bg-ink text-white' : 'text-pewter')}
                >
                  <Icon className="size-3.5" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section aria-label="Guide" className="rounded-[14px] border border-rule bg-white p-3">
          <h2 className="m-0 mb-2 flex items-center gap-2 text-[15px] font-bold">
            <Sparkles className="size-4 text-review" aria-hidden /> What to do next
            <span className="text-[12px] font-normal text-pewter">
              {mode === 'autoplay'
                ? 'autoplay: the team acts on these by itself; switch to Guided to act yourself'
                : 'camera, Gemini and rules suggest; you decide'}
            </span>
          </h2>
          {narration.length ? <ShiftLog narration={narration} /> : null}
          {!playing && !ended && mode === 'guided' ? (
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

const KIND_LABEL: Record<Narration['kind'], string> = {
  autopilot: 'Team',
  camera: 'Camera',
  gemini: 'Gemini',
  arrival: 'Host stand',
  rules: 'Rules',
}

/** The latest narration line, shown over the footage for a few media seconds. */
function Caption({ narration, media }: { narration: Narration[]; media: number }) {
  const latest = narration[narration.length - 1]
  if (!latest || media - latest.t > 2.5) return null
  return (
    <div className="pointer-events-none absolute inset-x-6 bottom-16 flex justify-center" aria-live="polite">
      <p className="m-0 max-w-[90%] rounded-lg bg-black/75 px-3 py-2 text-center text-[14px] text-white">
        <b className="mr-1.5 text-[11px] tracking-wide text-[#ecb240] uppercase">{KIND_LABEL[latest.kind]}</b>
        {latest.text}
      </p>
    </div>
  )
}

function ShiftLog({ narration }: { narration: Narration[] }) {
  return (
    <details className="mb-2 text-[13px]">
      <summary className="cursor-pointer text-pewter">Shift log ({narration.length})</summary>
      <ol className="m-0 mt-1 max-h-40 list-none space-y-0.5 overflow-y-auto p-0">
        {[...narration].reverse().map((n, i) => (
          <li key={`${n.t}-${i}`}>
            <span className="font-mono text-pewter">{n.t.toFixed(1)}s</span>{' '}
            <b>{KIND_LABEL[n.kind]}:</b> {n.text}
          </li>
        ))}
      </ol>
    </details>
  )
}
