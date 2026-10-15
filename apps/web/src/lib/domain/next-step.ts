import type { TableActionRequest, TableBoardEntry, TaskActionRequest } from '@/lib/api/types'
import type { Persona } from '@/lib/identity/personas'
import { can } from './permissions'
import { openTask } from './status'

export type StepInput =
  | { kind: 'table'; tableId: string; request: TableActionRequest }
  | { kind: 'task'; tableId: string; taskId: string; request: TaskActionRequest }

export interface Step {
  label: string
  /** Visual weight. `ready` is the green "Mark ready" action; `primary` is ink. */
  tone: 'primary' | 'ready' | 'secondary'
  input: StepInput
  success: string
  /** When set, the action asks for a second tap with this explanation (FR09: at most two taps). */
  confirm?: string
}

export interface NextSteps {
  primary: Step | null
  secondary: Step[]
  /** Why there is no action, in plain language. */
  note: string | null
}

const NONE: NextSteps = { primary: null, secondary: [], note: null }

/** Decides the controls a person sees for a table, mirroring the backend's state and owner rules. */
export function nextSteps(entry: TableBoardEntry, actor: Persona | null): NextSteps {
  const { table, session } = entry
  const id = table.table_id
  const version = session.state_version
  const state = session.operational_state

  if (!actor) {
    return { ...NONE, note: "Sign-in isn't available in this build yet, so the board is view-only." }
  }
  if (actor.role === 'host') {
    if (state === 'ready') return NONE
    return { ...NONE, note: 'Hosts seat parties at ready tables. Floor staff update the others.' }
  }

  const tableStep = (
    request: TableActionRequest,
    label: string,
    tone: Step['tone'],
    success: string,
    confirm?: string,
  ): Step => ({ label, tone, success, confirm, input: { kind: 'table', tableId: id, request } })

  if (state === 'departure_review' && can(actor.role, 'confirm_departure')) {
    return {
      primary: tableStep(
        { action: 'confirm_departure', expected_version: version },
        'Confirm departure',
        'primary',
        `Departure confirmed on ${id}`,
        `Has the party left ${id}? This releases the table and adds it to the clearing queue.`,
      ),
      secondary: [
        tableStep({ action: 'dismiss_review', expected_version: version }, 'Keep seated', 'secondary', `${id} kept seated`),
      ],
      note: null,
    }
  }

  if (state === 'occupied' && can(actor.role, 'confirm_departure')) {
    return {
      primary: null,
      secondary: [
        tableStep(
          { action: 'request_departure_review', expected_version: version },
          'Ask for a departure check',
          'secondary',
          `Departure check requested on ${id}`,
        ),
        tableStep(
          { action: 'confirm_departure', expected_version: version },
          'Confirm departure',
          'secondary',
          `Departure confirmed on ${id}`,
          `Has the party left ${id}? This releases the table and adds it to the clearing queue.`,
        ),
      ],
      note: null,
    }
  }

  const task = openTask(entry)
  if (task && (state === 'needs_clearing' || state === 'cleaning')) {
    const taskStep = (
      request: TaskActionRequest,
      label: string,
      tone: Step['tone'],
      success: string,
    ): Step => ({
      label,
      tone,
      success,
      input: { kind: 'task', tableId: id, taskId: task.task_id, request: { ...request, expected_version: version } },
    })
    const ownsTask = task.owner_id === actor.id || actor.role === 'manager'
    const release = taskStep({ action: 'release' }, 'Release task', 'secondary', `${id} released`)

    if (task.status === 'unassigned' && can(actor.role, 'claim_task')) {
      return { primary: taskStep({ action: 'claim' }, 'Claim', 'primary', `${id} claimed`), secondary: [], note: null }
    }
    if (task.status === 'claimed') {
      if (!ownsTask) return { ...NONE, note: `Claimed by ${task.owner_id}.` }
      return {
        primary: taskStep({ action: 'start' }, 'Start cleaning', 'primary', `Cleaning started on ${id}`),
        secondary: [release],
        note: null,
      }
    }
    if (task.status === 'started') {
      if (!ownsTask) return { ...NONE, note: `${task.owner_id} is cleaning this table.` }
      return {
        primary: taskStep({ action: 'complete' }, 'Mark ready', 'ready', `${id} is ready`),
        secondary: [release],
        note: null,
      }
    }
  }

  return NONE
}
