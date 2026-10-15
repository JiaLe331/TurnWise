// Mirrors backend/turnwise/contracts.py. Keep field names identical to the API.

export type UserRole = 'host' | 'floor_staff' | 'manager'

export type OperationalState =
  | 'occupied'
  | 'departure_review'
  | 'needs_clearing'
  | 'cleaning'
  | 'ready'

export type TaskStatus = 'unassigned' | 'claimed' | 'started' | 'completed' | 'cancelled'

export interface Table {
  outlet_id: string
  table_id: string
  capacity: number
  zone: string
  attributes: string[]
  camera_id: string | null
  region: Record<string, unknown> | null
  configuration_version: number
  blocked: boolean
}

export interface TableSession {
  session_id: string
  table_id: string
  party_id: string | null
  operational_state: OperationalState
  state_version: number
  last_valid_observation_at: string | null
  seated_at: string | null
  departed_at: string | null
  ready_at: string | null
  manual: boolean
}

export interface ClearingTask {
  task_id: string
  session_id: string
  table_id: string
  status: TaskStatus
  priority_reason: string
  owner_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type VisualStatus = 'occupied' | 'vacant' | 'unclear'

export interface TableCheck {
  people_present: boolean
  state: 'clear_and_set' | 'leftovers' | 'unclear'
  items: string[]
  reason: string
  checked_at: string
  model: string
  prompt_version: string
}

export interface TableEvidence {
  camera_id: string
  source_mode: string | null
  visual_status: VisualStatus | null
  object_flags: string[]
  occlusion: boolean
  reason: string | null
  uncertainty_reasons: string[]
  model_version: string | null
  last_observed_at: string | null
  vacant_since: string | null
  stale: boolean
  review_source: 'observation' | null
  table_check: TableCheck | null
}

export interface TableBoardEntry {
  table: Table
  session: TableSession
  task: ClearingTask | null
  evidence?: TableEvidence | null
}

export type PartyStatus = 'waiting' | 'on_hold' | 'seated' | 'cancelled' | 'left'

export interface QueueParty {
  party_id: string
  queue_code: string
  size: number
  arrival_at: string
  requirements: string[]
  status: PartyStatus
  version: number
  table_id: string | null
  seated_at: string | null
  ended_at: string | null
}

export interface SeatingHold {
  hold_id: string
  party_id: string
  table_id: string
  expires_at: string
  version: number
  status: 'active' | 'confirmed' | 'cancelled' | 'expired'
  created_at: string
  created_by: string
  table_state_version: number
  manual: boolean
  override_reason: string | null
}

export interface Board {
  outlet_id: string
  generated_at: string
  tables: TableBoardEntry[]
  clearing_queue: TableBoardEntry[]
  waitlist?: QueueParty[]
  holds?: SeatingHold[]
}

export interface TableOption {
  table_id: string
  capacity: number
  zone: string
  attributes: string[]
  table_version: number
  ready_at: string | null
  evidence: 'camera' | 'manual'
  reason: string
}

export interface Recommendation {
  generated_at: string
  party: QueueParty | null
  tables: TableOption[]
  skipped: { party_id: string; queue_code: string; reason: string }[]
  message: string
}

export interface SeatingResult {
  hold: SeatingHold
  party: QueueParty
  table: TableBoardEntry
}

export interface MetricSummary {
  metric: string
  count: number
  median_s: number | null
  p90_s: number | null
}

export interface ShiftMetrics {
  window_start: string
  window_end: string
  durations: MetricSummary[]
  counts: Record<string, number>
  vision_review_correction_rate: number | null
  notes: string[]
}

export interface ShiftBriefing {
  generated_at: string
  model: string
  briefing: { headline: string; highlights: string[]; suggestions: string[] }
}

export interface ShiftAnswer {
  question: string
  model: string
  result: { answer: string; facts_used: string[]; answerable: boolean }
}

export interface ShiftInsights {
  model: string
  insights: {
    recommendations: { title: string; evidence: string; expected_impact: string; effort: 'low' | 'medium' | 'high' }[]
  }
}

export type TableAction =
  | 'request_departure_review'
  | 'dismiss_review'
  | 'confirm_departure'
  | 'mark_ready'
  | 'override_state'
  | 'release_override'
  | 'block'
  | 'unblock'

export type TaskAction = 'claim' | 'start' | 'release' | 'complete' | 'cancel'

export interface TableActionRequest {
  action: TableAction
  expected_version?: number | null
  reason?: string | null
  target_state?: OperationalState | null
}

export interface TaskActionRequest {
  action: TaskAction
  expected_version?: number | null
  reason?: string | null
}

export interface CreatePartyRequest {
  queue_code: string
  size: number
  arrival_at?: string | null
  requirements: string[]
}

export type PartyAction = 'update' | 'cancel' | 'left'

export interface PartyActionRequest {
  action: PartyAction
  expected_version: number
  size?: number | null
  requirements?: string[] | null
  reason?: string | null
}

export interface CreateHoldRequest {
  party_id: string
  table_id: string
  party_version: number
  table_version: number
  override_reason?: string | null
}

export type HoldAction = 'confirm' | 'cancel'

export interface HoldActionRequest {
  action: HoldAction
  expected_version: number
  reason?: string | null
}
