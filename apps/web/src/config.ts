export const OUTLET_ID = 'demo-outlet'
/** The seeded in-memory outlet. Its data is labelled as demo data everywhere it appears. */
export const IS_DEMO_OUTLET = OUTLET_ID === 'demo-outlet'

export const POLL_MS = 4000
/** No successful board update for this long shows "Updates delayed". */
export const DELAYED_AFTER_MS = 15_000
/** No successful board update for this long treats the board as offline and pauses actions. */
export const OFFLINE_AFTER_MS = 30_000
/** Client-side threshold for the manager's "Unclaimed for 600+ s" exception. Not a server alert. */
export const UNCLAIMED_ALERT_S = 600
/**
 * Persona switcher and X-Actor headers. On in development; a production build enables it with
 * VITE_DEMO_IDENTITY=true for the no-sign-in demo deployment.
 */
export const DEMO_IDENTITY = import.meta.env.DEV || import.meta.env.VITE_DEMO_IDENTITY === 'true'
/**
 * Backend origin for a frontend hosted apart from the API (e.g. https://api.example.com), set at
 * build time with VITE_BACKEND_URL. Empty means same origin: the dev proxy or Caddy serves /api.
 */
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
export const API_BASE = `${BACKEND_URL}/api`
export const DEMO_VIDEO_SRC = `${BACKEND_URL}/demo-media/mixkit-720p.mp4`
