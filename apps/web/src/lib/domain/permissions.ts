import type { UserRole } from '@/lib/api/types'

// Mirror of backend/turnwise/domain/roles.py PERMISSIONS, used only to decide which controls to
// show. The API remains the authority and answers 403 for anything this table gets wrong.
const STAFF: ReadonlySet<UserRole> = new Set(['floor_staff', 'manager'])
const MANAGER: ReadonlySet<UserRole> = new Set(['manager'])
const HOSTS: ReadonlySet<UserRole> = new Set(['host', 'manager'])

const PERMISSIONS = {
  request_departure_review: STAFF,
  dismiss_review: STAFF,
  confirm_departure: STAFF,
  mark_ready: STAFF,
  override_state: MANAGER,
  release_override: STAFF,
  block: MANAGER,
  unblock: MANAGER,
  claim_task: STAFF,
  start_task: STAFF,
  release_task: STAFF,
  complete_task: STAFF,
  cancel_task: MANAGER,
  create_party: HOSTS,
  update_party: HOSTS,
  cancel_party: HOSTS,
  left_party: HOSTS,
  create_hold: HOSTS,
  confirm_hold: HOSTS,
  cancel_hold: HOSTS,
} as const

export type Permission = keyof typeof PERMISSIONS

export function can(role: UserRole | undefined | null, permission: Permission): boolean {
  return role != null && PERMISSIONS[permission].has(role)
}

export const ROLE_LABEL: Record<UserRole, string> = {
  host: 'Host',
  floor_staff: 'Floor staff',
  manager: 'Manager',
}
