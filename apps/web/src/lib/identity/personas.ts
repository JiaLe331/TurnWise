import type { Actor } from '@/lib/api/client'

export interface Persona extends Actor {
  initials: string
}

/** Local-development identities. `staff-ana` owns the seeded cleaning task on T5. */
export const PERSONAS: Persona[] = [
  { id: 'host-1', role: 'host', initials: 'H1' },
  { id: 'staff-ana', role: 'floor_staff', initials: 'AN' },
  { id: 'staff-ben', role: 'floor_staff', initials: 'BE' },
  { id: 'manager-1', role: 'manager', initials: 'M1' },
]

export function initialsFor(actorId: string): string {
  const persona = PERSONAS.find((p) => p.id === actorId)
  if (persona) return persona.initials
  const name = actorId.replace(/^(staff|host|manager)-/, '')
  return name.slice(0, 2).toUpperCase()
}
