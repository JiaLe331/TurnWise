import type { OperationalState, TableBoardEntry } from '@/lib/api/types'

// A static sample floor for the landing illustration. It mirrors the seeded demo outlet's shape but
// is never fetched from or presented as the live board.
const LAYOUT: [string, number, string, string[], OperationalState, number][] = [
  ['T1', 2, 'Main', [], 'occupied', 35],
  ['T2', 2, 'Main', [], 'occupied', 20],
  ['T3', 2, 'Main', [], 'occupied', 44],
  ['T4', 4, 'Main', ['accessible'], 'needs_clearing', 6],
  ['T5', 4, 'Main', [], 'cleaning', 4],
  ['T6', 4, 'Main', [], 'occupied', 48],
  ['T7', 4, 'Main', [], 'occupied', 50],
  ['T8', 6, 'Main', [], 'occupied', 12],
  ['T9', 2, 'Patio', ['outdoor'], 'ready', 8],
  ['T10', 4, 'Patio', ['outdoor'], 'occupied', 28],
  ['T11', 4, 'Patio', ['outdoor'], 'needs_clearing', 2],
  ['T12', 8, 'Patio', ['outdoor'], 'occupied', 41],
]

export const STORY_TABLE = 'T6'

export function sampleFloor(storyState: OperationalState, now = Date.now()): TableBoardEntry[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  return LAYOUT.map(([id, capacity, zone, attributes, seedState, minutes]) => {
    const state = id === STORY_TABLE ? storyState : seedState
    const minutesInState = id === STORY_TABLE ? 1 : minutes
    const clearing = state === 'needs_clearing' || state === 'cleaning'
    return {
      table: {
        outlet_id: 'sample',
        table_id: id,
        capacity,
        zone,
        attributes,
        camera_id: null,
        region: null,
        configuration_version: 1,
        blocked: false,
      },
      session: {
        session_id: `sample_${id}`,
        table_id: id,
        party_id: state === 'occupied' || state === 'departure_review' ? `party_${id}` : null,
        operational_state: state,
        state_version: 1,
        last_valid_observation_at: null,
        seated_at: state === 'occupied' || state === 'departure_review' ? ago(minutesInState) : null,
        departed_at: clearing || state === 'ready' ? ago(minutesInState) : null,
        ready_at: state === 'ready' ? ago(minutesInState) : null,
        manual: false,
      },
      task: clearing
        ? {
            task_id: `sample_task_${id}`,
            session_id: `sample_${id}`,
            table_id: id,
            status: state === 'cleaning' ? 'started' : 'unassigned',
            priority_reason: 'Oldest confirmed departure first',
            // Ana takes the story table; the other cleaning table belongs to someone else.
            owner_id: state === 'cleaning' ? (id === STORY_TABLE ? 'staff-ana' : 'staff-ben') : null,
            created_at: ago(minutesInState),
            started_at: state === 'cleaning' ? ago(minutesInState) : null,
            completed_at: null,
          }
        : null,
    }
  })
}
