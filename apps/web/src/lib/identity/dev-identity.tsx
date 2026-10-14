import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { PERSONAS, type Persona } from './personas'

const STORAGE_KEY = 'turnwise.dev-persona'

interface IdentityValue {
  /** The acting persona. Always null in production builds until real sign-in exists. */
  actor: Persona | null
  setActorId: (id: string) => void
}

const IdentityContext = createContext<IdentityValue>({ actor: null, setActorId: () => {} })

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [actorId, setId] = useState<string | null>(() =>
    import.meta.env.DEV ? (readStored() ?? 'staff-ana') : null,
  )

  const setActorId = useCallback((id: string) => {
    if (!import.meta.env.DEV) return
    setId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Storage unavailable (private mode); the choice lasts for this tab only.
    }
  }, [])

  const value = useMemo<IdentityValue>(
    () => ({ actor: PERSONAS.find((p) => p.id === actorId) ?? null, setActorId }),
    [actorId, setActorId],
  )

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export function useIdentity() {
  return useContext(IdentityContext)
}
