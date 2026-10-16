import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useSearchParams } from 'wouter'
import { demoApi, type DemoMode, type DemoSessionInfo, type DemoTimeline, type Narration } from '@/features/demo/api'
import { API_BASE } from '@/config'
import { setApiScope } from '@/lib/api/client'

const TICK_EVERY_S = 0.25 // media seconds between demo-clock updates

interface ReplayValue {
  /** A replay session is running (or the viewer is choosing how to start one). */
  active: boolean
  session: DemoSessionInfo | null
  timeline: DemoTimeline | undefined
  /** The start dialog is open. */
  choosing: boolean
  starting: boolean
  error: string | null
  mode: DemoMode
  playing: boolean
  speed: number
  ended: boolean
  mediaNow: number
  narration: Narration[]
  simNow: string | null
  openChooser: () => void
  start: (mode: DemoMode) => Promise<void>
  restart: () => void
  changeMode: (mode: DemoMode) => void
  setPlaying: (playing: boolean) => void
  setSpeed: (speed: number) => void
  setEnded: (ended: boolean) => void
  onTime: (mediaS: number) => void
  /** Guide hints already shown this session, so Guided mode pauses once per hint across views. */
  seenHints: MutableRefObject<Set<string>>
  /** The hint Guided mode last paused for. */
  freshHint: string | null
  setFreshHint: (id: string | null) => void
}

const ReplayContext = createContext<ReplayValue | null>(null)

/**
 * The recorded replay as a data source. It lives above the role views so switching between host,
 * staff and manager keeps the same session and the same video (which drives the demo clock).
 * Every request goes to the viewer's isolated demo session; the live outlet is never touched.
 */
export function ReplayProvider({ children }: { children: ReactNode }) {
  const [, setParams] = useSearchParams()
  // The recorded replay is the only source the views offer; the live outlet stays API-only.
  const wantsReplay = true
  const queryClient = useQueryClient()
  const [session, setSession] = useState<DemoSessionInfo | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<DemoMode>('autoplay')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(0.25)
  const [ended, setEnded] = useState(false)
  const [mediaNow, setMediaNow] = useState(0)
  const [narration, setNarration] = useState<Narration[]>([])
  const [simNow, setSimNow] = useState<string | null>(null)
  const lastTick = useRef(-1)
  const seenHints = useRef(new Set<string>())
  const [freshHint, setFreshHint] = useState<string | null>(null)
  const timeline = useQuery({
    queryKey: ['demo-timeline'],
    queryFn: demoApi.timeline,
    staleTime: Infinity,
    enabled: Boolean(session) || choosing,
  })

  const setSource = useCallback(
    (replay: boolean) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (replay) next.set('source', 'replay')
          else next.delete('source')
          next.delete('table')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  // A deep link such as /host?source=replay asks how to start.
  useEffect(() => {
    if (wantsReplay && !session && !starting) setChoosing(true)
  }, [wantsReplay, session, starting])

  // Leaving the floor app (for example back to the landing page) ends the scope.
  useEffect(() => () => setApiScope({ base: API_BASE }), [])

  const start = useCallback(
    async (chosen: DemoMode) => {
      setStarting(true)
      setError(null)
      try {
        const info = await demoApi.start(chosen)
        setApiScope({ base: `${API_BASE}/demo`, headers: { 'X-Demo-Session': info.session_id } })
        lastTick.current = -1
        seenHints.current = new Set()
        setFreshHint(null)
        setMode(chosen)
        setPlaying(true)
        setEnded(false)
        setMediaNow(0)
        setNarration([])
        setSimNow(null)
        setSession(info)
        setChoosing(false)
        setSource(true)
      } catch {
        setError('The replay service is not reachable. Start the API and try again.')
      } finally {
        setStarting(false)
      }
    },
    [setSource],
  )

  const restart = useCallback(() => void start(mode), [start, mode])

  const changeMode = useCallback(
    (next: DemoMode) => {
      setMode(next)
      if (next === 'autoplay') setPlaying(true)
      if (session) void demoApi.setMode(session.session_id, next).then((r) => setNarration(r.narration), () => undefined)
    },
    [session],
  )

  const onTime = useCallback(
    (t: number) => {
      if (!session) return
      if (t - lastTick.current < TICK_EVERY_S && t < session.duration_s - 0.05) return
      lastTick.current = t
      setMediaNow(t)
      void demoApi.tick(session.session_id, t).then(
        (r) => {
          setNarration(r.narration)
          setSimNow(r.sim_now)
          void queryClient.invalidateQueries({ queryKey: ['board'] })
        },
        () => undefined,
      )
    },
    [session, queryClient],
  )

  const value = useMemo<ReplayValue>(
    () => ({
      active: Boolean(session) || choosing,
      session,
      timeline: timeline.data,
      choosing,
      starting,
      error,
      mode,
      playing,
      speed,
      ended,
      mediaNow,
      narration,
      simNow,
      openChooser: () => setChoosing(true),
      start,
      restart,
      changeMode,
      setPlaying,
      setSpeed,
      setEnded,
      onTime,
      seenHints,
      freshHint,
      setFreshHint,
    }),
    [session, timeline.data, choosing, starting, error, mode, playing, speed, ended, mediaNow, narration, simNow, start, restart, changeMode, onTime, freshHint],
  )

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>
}

export function useReplay(): ReplayValue {
  const value = useContext(ReplayContext)
  if (!value) throw new Error('useReplay must be used inside ReplayProvider')
  return value
}
