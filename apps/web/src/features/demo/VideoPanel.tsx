import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { DemoTimeline } from './api'

const ZONE: Record<string, { fill: string; line: string; label: string }> = {
  occupied: { fill: 'rgba(236,178,64,0.30)', line: '#ecb240', label: 'occupied' },
  vacant: { fill: 'rgba(120,205,110,0.28)', line: '#78cd6e', label: 'vacant' },
  unclear: { fill: 'rgba(170,170,170,0.30)', line: '#aaaaaa', label: 'unclear' },
}
const LEFTOVERS = { fill: 'rgba(225,80,80,0.30)', line: '#e15050' }
export const SPEEDS = [0.25, 0.5, 1] as const

type Point = [number, number]

function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Point[] = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function mmss(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

interface VideoPanelProps {
  src: string
  timeline: DemoTimeline
  speed: number
  onSpeed: (speed: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  onTime: (mediaS: number) => void
  onEnded: () => void
  onRestart: () => void
  timeScale: number
  /** 'minimal' leaves only the camera name on the picture, for hosts that draw their own controls. */
  chrome?: 'full' | 'minimal'
}

/**
 * The replayed footage with the camera-wall overlay. Zones and tags come from the precomputed
 * timeline sample for the current frame, so the overlay always matches the image underneath.
 */
export function VideoPanel(props: VideoPanelProps) {
  const { src, timeline, speed, playing, onTime, onEnded } = props
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [now, setNow] = useState(0)
  const zones = useMemo(
    () =>
      timeline.manifest.tables.map((t) => ({
        id: t.table_id,
        hull: hull([...t.tabletop, ...t.seats.flat()] as Point[]),
      })),
    [timeline],
  )

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const v = video.current
    if (!v) return
    if (playing) void v.play().catch(() => props.onPlaying(false))
    else v.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // Draw every animation frame while visible; report media time for the session clock.
  useEffect(() => {
    let raf = 0
    let lastReport = 0
    const draw = () => {
      const v = video.current
      const c = canvas.current
      if (v && c) {
        const t = v.currentTime
        const rect = c.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        if (c.width !== Math.round(rect.width * dpr)) {
          c.width = Math.round(rect.width * dpr)
          c.height = Math.round(rect.height * dpr)
        }
        paint(c, t, rect.width, rect.height, dpr)
        if (Math.abs(t - lastReport) >= 0.05) {
          lastReport = t
          setNow(t)
          onTime(t)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline])

  function paint(c: HTMLCanvasElement, t: number, w: number, h: number, dpr: number) {
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const { width: vw, height: vh } = timeline.manifest
    const k = Math.min(w / vw, h / vh)
    const ox = (w - vw * k) / 2
    const oy = (h - vh * k) / 2
    const index = Math.min(timeline.samples.length - 1, Math.max(0, Math.round(t * 12)))
    const sample = timeline.samples[index]
    g.font = '600 12px var(--font-sans), system-ui, sans-serif'
    for (const zone of zones) {
      const [shown, , seated] = sample.tables[zone.id]
      const check = [...timeline.gemini_checks].reverse().find((c) => c.table_id === zone.id && c.t <= t)
      const leftovers = shown !== 'occupied' && check?.state === 'leftovers'
      const style = leftovers ? LEFTOVERS : ZONE[shown]
      g.beginPath()
      zone.hull.forEach(([x, y], i) => (i ? g.lineTo(ox + x * k, oy + y * k) : g.moveTo(ox + x * k, oy + y * k)))
      g.closePath()
      g.fillStyle = style.fill
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = style.line
      g.stroke()
      let text = `${zone.id} ${ZONE[shown].label}${shown === 'occupied' && seated ? ` · ${seated}` : ''}`
      if (check && shown !== 'occupied') text += ` · Gemini: ${check.state.replace(/_/g, ' ')}`
      const minX = Math.min(...zone.hull.map((p) => p[0]))
      const minY = Math.min(...zone.hull.map((p) => p[1]))
      const tx = ox + minX * k + 4
      const ty = oy + minY * k + 4
      const tw = g.measureText(text).width + 12
      g.fillStyle = style.line
      g.fillRect(tx, ty, tw, 20)
      g.fillStyle = '#16191d'
      g.fillText(text, tx + 6, ty + 14)
    }
  }

  const duration = timeline.duration_s
  const simSeconds = now * props.timeScale
  return (
    <section aria-label="Camera 02 replay" className="relative overflow-hidden rounded-[14px] bg-black">
      <video
        ref={video}
        src={src}
        muted
        playsInline
        preload="auto"
        onEnded={() => {
          onTime(duration)
          onEnded()
        }}
        className="block aspect-video w-full object-contain"
      />
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-black/70 px-2.5 py-1 font-mono text-[12px] tracking-wider text-white">
          {timeline.manifest.name.toUpperCase()}
        </span>
        {props.chrome === 'minimal' ? null : (
          <span className="rounded-md bg-black/70 px-2.5 py-1 text-[12px] text-white">
            Time-lapse replay · {speed}x · demo clock
          </span>
        )}
      </div>
      <div className={cn('absolute right-3 bottom-3 left-3 flex items-center gap-2', props.chrome === 'minimal' && 'hidden')}>
        <button
          type="button"
          onClick={() => props.onPlaying(!playing)}
          className="grid size-9 place-items-center rounded-lg bg-black/70 text-white hover:bg-black/85"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
        <div className="flex overflow-hidden rounded-lg bg-black/70" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => props.onSpeed(s)}
              aria-pressed={s === speed}
              className={cn('px-2.5 py-1.5 text-[12px] text-white/80', s === speed && 'bg-white/20 font-bold text-white')}
            >
              {s}x
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={props.onRestart}
          className="grid size-9 place-items-center rounded-lg bg-black/70 text-white hover:bg-black/85"
          aria-label="Restart demo"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25" aria-hidden>
          <div className="h-full bg-white" style={{ width: `${(now / duration) * 100}%` }} />
        </div>
        <span className="rounded-md bg-black/70 px-2 py-1 font-mono text-[12px] text-white">
          {mmss(now)} / {mmss(duration)} · shift +{Math.round(simSeconds)} s
        </span>
      </div>
      <p className="sr-only">Table zones show what the camera sees. Gemini notes appear on vacant tables.</p>
    </section>
  )
}
