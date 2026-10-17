import { useEffect, useState } from 'react'

/**
 * Elapsed times are measured against the server clock: the board's `generated_at` minus the local
 * time it arrived gives the offset, so a skewed tablet clock can't make a table look older.
 */
export function serverOffsetMs(generatedAt: string, receivedAt: number): number {
  return Date.parse(generatedAt) - receivedAt
}

export function secondsSince(iso: string, serverNow: number): number {
  return Math.max(0, Math.floor((serverNow - Date.parse(iso)) / 1000))
}

/** Every duration in the UI is whole seconds, so numbers compare at a glance. */
export function formatSeconds(seconds: number): string {
  return `${Math.round(seconds)} s`
}

/** "45 s ago", or "just now" under a second. */
export function formatAgo(seconds: number): string {
  return seconds < 1 ? 'just now' : `${formatSeconds(seconds)} ago`
}

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Re-renders on an interval so relative times stay current between polls. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
