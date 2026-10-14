import type { OperationalState } from '@/lib/api/types'
import type { Insets } from '@/features/floor-scene/FloorScene'
import { STORY_TABLE } from './sample'

export type CalloutSource = 'camera' | 'staff' | null

export interface CameraKey {
  /** Table ids to centre on (their midpoint), or null for the whole floor. */
  focus: string[] | null
  /** World offset added to the focus point, e.g. to bring a wall into frame. */
  offset?: [number, number, number]
  zoomK: number
  azimuthDeg: number
  elevationDeg: number
  wide: Insets
  phone: Insets
}

export interface Chapter {
  id: string
  /** Relative share of the scroll track. */
  length: number
  storyState: OperationalState
  guests: boolean
  /** Shown in the chapter card; hero and outro have none. */
  step: { number: number; title: string; body: string } | null
  callout: { title: string; text: string; source: CalloutSource; side?: 'left' | 'right' } | null
  /** Concept-only chapters carry an explicit label. */
  concept: boolean
  /** Which floor tags to show while this chapter is active. */
  tags: 'all' | 'queue' | 'none'
  camera: CameraKey
}

const FOCUS_WIDE: Insets = { left: 400, bottom: 110, top: 80, right: 24 }
const FOCUS_PHONE: Insets = { top: 80, bottom: 250 }

export const CHAPTERS: Chapter[] = [
  {
    id: 'hero',
    length: 0.9,
    storyState: 'occupied',
    guests: true,
    step: null,
    callout: null,
    concept: false,
    tags: 'all',
    camera: {
      focus: null,
      zoomK: 1,
      azimuthDeg: 45,
      elevationDeg: 31,
      wide: { left: 560, top: 80, bottom: 40, right: 24 },
      phone: { top: 430, bottom: 30 },
    },
  },
  {
    id: 'seated',
    length: 1.1,
    storyState: 'occupied',
    guests: true,
    step: {
      number: 1,
      title: 'Seated',
      body: 'The party owns the table, even when they step away. TurnWise never releases a table on its own.',
    },
    callout: { title: 'Party of four', text: 'Seated 48 minutes. A bag is still on a chair.', source: null },
    concept: false,
    tags: 'none',
    camera: { focus: [STORY_TABLE], zoomK: 2.6, azimuthDeg: 57, elevationDeg: 33, wide: FOCUS_WIDE, phone: FOCUS_PHONE },
  },
  {
    id: 'camera',
    length: 1.4,
    storyState: 'departure_review',
    guests: false,
    step: {
      number: 2,
      title: 'A camera notices',
      body: 'The seats have been empty for 30 seconds, so a camera asks staff to check. It can suggest a check. It can never release a table.',
    },
    callout: {
      title: 'Seats look empty',
      text: 'Vacant for 30 seconds across 3 frames. The party keeps the table until staff decide.',
      source: 'camera',
      side: 'left',
    },
    concept: true,
    tags: 'none',
    camera: {
      focus: [STORY_TABLE],
      offset: [0, 0.6, -1.6],
      zoomK: 1.9,
      azimuthDeg: 40,
      elevationDeg: 38,
      wide: FOCUS_WIDE,
      phone: FOCUS_PHONE,
    },
  },
  {
    id: 'confirm',
    length: 1.1,
    storyState: 'needs_clearing',
    guests: false,
    step: {
      number: 3,
      title: 'Staff confirm',
      body: 'Floor staff confirm the party has left with one tap. A clearing task joins the queue.',
    },
    callout: { title: 'Departure confirmed', text: 'One tap from floor staff. A clearing task appears.', source: 'staff' },
    concept: false,
    tags: 'none',
    camera: { focus: [STORY_TABLE], zoomK: 3, azimuthDeg: 50, elevationDeg: 28, wide: FOCUS_WIDE, phone: FOCUS_PHONE },
  },
  {
    id: 'cleaning',
    length: 1.2,
    storyState: 'cleaning',
    guests: false,
    step: {
      number: 4,
      title: 'Cleaning',
      body: 'Someone claims the task and starts cleaning. Everyone sees who has it, and which table is next in the clearing order.',
    },
    callout: { title: 'Claimed by Ana', text: 'Cleaning started. Nobody doubles up.', source: 'staff' },
    concept: false,
    tags: 'queue',
    camera: { focus: ['T4', 'T5', STORY_TABLE, 'T11'], zoomK: 1.45, azimuthDeg: 48, elevationDeg: 36, wide: FOCUS_WIDE, phone: FOCUS_PHONE },
  },
  {
    id: 'ready',
    length: 1.1,
    storyState: 'ready',
    guests: false,
    step: {
      number: 5,
      title: 'Ready',
      body: 'Staff mark the table ready. The host sees it straight away and can seat the next party.',
    },
    callout: { title: 'Ready to seat', text: 'Reset for four. Confirmed by floor staff, not the camera.', source: 'staff' },
    concept: false,
    tags: 'none',
    camera: { focus: [STORY_TABLE], zoomK: 2.7, azimuthDeg: 60, elevationDeg: 32, wide: FOCUS_WIDE, phone: FOCUS_PHONE },
  },
  {
    id: 'outro',
    length: 1,
    storyState: 'ready',
    guests: false,
    step: null,
    callout: null,
    concept: false,
    tags: 'all',
    camera: {
      focus: null,
      zoomK: 1,
      azimuthDeg: 45,
      elevationDeg: 31,
      wide: { top: 90, bottom: 260, left: 24, right: 24 },
      phone: { top: 80, bottom: 330 },
    },
  },
]

export const STEP_CHAPTERS = CHAPTERS.filter((c) => c.step)

const TOTAL = CHAPTERS.reduce((sum, c) => sum + c.length, 0)
/** Start and end of each chapter as fractions of the track. */
export const BOUNDS = CHAPTERS.reduce<{ start: number; end: number }[]>((acc, c) => {
  const start = acc.length ? acc[acc.length - 1].end : 0
  acc.push({ start, end: start + c.length / TOTAL })
  return acc
}, [])

export function chapterAt(p: number): { index: number; local: number } {
  const clamped = Math.min(1, Math.max(0, p))
  const found = BOUNDS.findIndex((b) => clamped < b.end)
  const i = found === -1 ? CHAPTERS.length - 1 : found
  const b = BOUNDS[i]
  return { index: i, local: (clamped - b.start) / (b.end - b.start) }
}

/** Scroll position (0..1) at the middle of a chapter, for jump links. */
export function chapterCentre(index: number): number {
  const b = BOUNDS[index]
  return (b.start + b.end) / 2
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/**
 * The camera rests on each chapter's key in the middle 40% of the chapter and travels between keys
 * across the boundary, so scrolling always moves the camera toward the next scene.
 */
export function cameraBlend(p: number): { from: number; to: number; t: number } {
  const { index, local } = chapterAt(p)
  if (local < 0.3 && index > 0) return { from: index - 1, to: index, t: smoothstep(0.5 + local / 0.6) }
  if (local > 0.7 && index < CHAPTERS.length - 1) return { from: index, to: index + 1, t: smoothstep((local - 0.7) / 0.6) }
  return { from: index, to: index, t: 0 }
}

/** 0..1 visibility of the concept camera rig: fades in and out inside the camera chapter. */
export function conceptWeight(p: number): number {
  const i = CHAPTERS.findIndex((c) => c.concept)
  const { start, end } = BOUNDS[i]
  const span = end - start
  const fadeIn = (p - start) / (span * 0.2)
  const fadeOut = (end - p) / (span * 0.2)
  return Math.max(0, Math.min(1, fadeIn, fadeOut))
}
