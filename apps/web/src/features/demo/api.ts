import { request } from '@/lib/api/client'
import { API_BASE } from '@/config'
import type { Actor } from '@/lib/api/client'
import type { QueueParty, Recommendation, SeatingResult } from '@/lib/api/types'
import { shiftApi } from '@/lib/api/shift'

export type DemoMode = 'guided' | 'autoplay'

export interface Narration {
  t: number
  kind: 'autopilot' | 'camera' | 'gemini' | 'arrival' | 'rules'
  text: string
}

export interface TickResult {
  media_s: number
  sim_now: string
  mode: DemoMode
  narration: Narration[]
}

export interface DemoSessionInfo {
  session_id: string
  mode: DemoMode
  duration_s: number
  time_scale: number
  camera_id: string
  camera_name: string
}

type Point = [number, number]

export interface DemoTimeline {
  duration_s: number
  detector: string
  manifest: {
    camera_id: string
    name: string
    width: number
    height: number
    tables: { table_id: string; tabletop: Point[]; seats: Point[][] }[]
  }
  /** [shown status, raw status, seated count, object flags] per table. */
  samples: { t: number; tables: Record<string, [string, string, number, string[]]> }[]
  gemini_checks: {
    table_id: string
    t: number
    model: string
    state: 'clear_and_set' | 'leftovers' | 'unclear'
    items: string[]
    reason: string
    people_present: boolean
  }[]
}

const DEMO_BASE = `${API_BASE}/demo`

async function raw<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DEMO_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`Demo API returned ${response.status}`)
  return (await response.json()) as T
}

export const demoApi = {
  start: (mode: DemoMode) =>
    raw<DemoSessionInfo>('/sessions', { method: 'POST', body: JSON.stringify({ mode }) }),
  timeline: () => raw<DemoTimeline>('/timeline'),
  tick: (sessionId: string, mediaS: number) =>
    raw<TickResult>(`/sessions/${sessionId}/tick`, {
      method: 'POST',
      body: JSON.stringify({ media_s: mediaS }),
    }),
  setMode: (sessionId: string, mode: DemoMode) =>
    raw<TickResult>(`/sessions/${sessionId}/mode`, { method: 'POST', body: JSON.stringify({ mode }) }),
}

/** Calls below go through the scoped client, so they hit the viewer's demo session. */
const key = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

export const outletApi = {
  recommendation: () => request<Recommendation>('/recommendations'),
  createHold: (
    actor: Actor | null,
    body: { party_id: string; table_id: string; party_version: number; table_version: number; override_reason?: string },
  ) => request<SeatingResult>('/seating-holds', { method: 'POST', body, actor, idempotencyKey: key() }),
  holdAction: (actor: Actor | null, holdId: string, action: 'confirm' | 'cancel', expectedVersion: number) =>
    request<SeatingResult>(`/seating-holds/${holdId}/actions`, {
      method: 'POST',
      body: { action, expected_version: expectedVersion },
      actor,
      idempotencyKey: key(),
    }),
  partyAction: (actor: Actor | null, party: QueueParty, action: 'cancel' | 'left') =>
    request<QueueParty>(`/parties/${party.party_id}/actions`, {
      method: 'POST',
      body: { action, expected_version: party.version },
      actor,
      idempotencyKey: key(),
    }),
  // Shift metrics and Gemini calls now live in lib/api/shift.ts, shared with the main manager view.
  metrics: shiftApi.metrics,
  briefing: shiftApi.briefing,
  insights: shiftApi.insights,
  ask: shiftApi.ask,
}
