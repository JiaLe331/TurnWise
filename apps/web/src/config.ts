export const OUTLET_ID = 'demo-outlet'
/** The seeded in-memory outlet. Its data is labelled as demo data everywhere it appears. */
export const IS_DEMO_OUTLET = OUTLET_ID === 'demo-outlet'

export const POLL_MS = 4000
/** No successful board update for this long shows "Updates delayed". */
export const DELAYED_AFTER_MS = 15_000
/** No successful board update for this long treats the board as offline and pauses actions. */
export const OFFLINE_AFTER_MS = 30_000
/** Client-side threshold for the manager's "Unclaimed for 10+ min" exception. Not a server alert. */
export const UNCLAIMED_ALERT_MIN = 10
