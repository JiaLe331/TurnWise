import { useEffect, useState } from 'react'

/**
 * Elapsed times are measured against the server clock: the board's `generated_at` minus the local
 * time it arrived gives the offset, so a skewed tablet clock can't make a table look older.
 */
export function serverOffsetMs(generatedAt: string, receivedAt: number): number {
  return Date.parse(generatedAt) - receivedAt
}

export function minutesSince(iso: string, serverNow: number): number {
  return Math.max(0, Math.floor((serverNow - Date.parse(iso)) / 60_000))
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** "6 min ago", or "just now" under a minute. */
export function formatAgo(minutes: number): string {
  return minutes < 1 ? 'just now' : `${formatMinutes(minutes)} ago`
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
