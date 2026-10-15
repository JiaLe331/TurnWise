import { OUTLET_ID } from '@/config'
import { request, scopedFetch } from './client'
import type { ShiftAnswer, ShiftBriefing, ShiftInsights, ShiftMetrics } from './types'

const base = `/outlets/${OUTLET_ID}`

/** Shift metrics and Gemini summaries for the manager. All calls follow the current API scope. */
export const shiftApi = {
  metrics: () => request<ShiftMetrics>(`${base}/metrics`),
  briefing: () => request<ShiftBriefing>(`${base}/briefing`),
  insights: () => request<ShiftInsights>(`${base}/insights`),
  ask: (question: string) => request<ShiftAnswer>(`${base}/ask`, { method: 'POST', body: { question } }),

  /** Downloads the metrics as CSV (cycle rows), keeping the scope headers a plain link would lose. */
  async downloadCsv(): Promise<void> {
    const response = await scopedFetch(`${base}/metrics?format=csv`)
    if (!response.ok) throw new Error(`The export failed (${response.status}).`)
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'turnwise-metrics.csv'
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  },
}
