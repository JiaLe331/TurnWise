import type { UIDataTypes, UIMessage } from 'ai'

/** Mirrors `propose_action` in backend/turnwise/domain/assistant.py. */
export interface Proposal {
  kind: 'table' | 'task' | 'seat' | 'party'
  action: string
  table_id?: string
  task_id?: string
  party_id?: string
  title: string
  reason: string
}

export interface ProposalOutcome {
  status: 'done' | 'declined' | 'failed'
  detail: string
}

export interface Chart {
  title: string
  unit: string
  bars: { label: string; value: number }[]
}

type Lookup = { input: Record<string, unknown>; output: unknown }

export type AssistantTools = {
  get_shift_metrics: Lookup
  get_floor_now: Lookup
  get_recent_events: Lookup
  get_table: { input: { table_id: string }; output: unknown }
  show_chart: { input: Chart; output: Chart }
  propose_action: { input: Proposal; output: ProposalOutcome }
}

export type AssistantMessage = UIMessage<{ spoken?: boolean }, UIDataTypes, AssistantTools>
export type AssistantPart = AssistantMessage['parts'][number]
