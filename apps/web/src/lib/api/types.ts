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

export interface TableBoardEntry {
  table: Table
  session: TableSession
  task: ClearingTask | null
}

export interface Board {
  outlet_id: string
  generated_at: string
  tables: TableBoardEntry[]
  clearing_queue: TableBoardEntry[]
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
