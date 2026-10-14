import { useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export type Layout = 'phone' | 'tablet' | 'desktop'

/** Phone below 768px, tablet up to 1279px, desktop from 1280px. */
export function useLayout(): Layout {
  const desktop = useMediaQuery('(min-width: 1280px)')
  const tablet = useMediaQuery('(min-width: 768px)')
  return desktop ? 'desktop' : tablet ? 'tablet' : 'phone'
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
