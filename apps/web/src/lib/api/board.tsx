import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { DELAYED_AFTER_MS, OFFLINE_AFTER_MS, OUTLET_ID, POLL_MS } from '@/config'
import { useIdentity } from '@/lib/identity/dev-identity'
import type { StepInput } from '@/lib/domain/next-step'
import { compareTableIds } from '@/lib/domain/status'
import { serverOffsetMs, useNow } from '@/lib/domain/time'
import { ApiError, apiScopeKey, NetworkError, request } from './client'
import type {
  Board,
  CreateHoldRequest,
  CreatePartyRequest,
  HoldActionRequest,
  PartyActionRequest,
  QueueParty,
  SeatingResult,
  TableBoardEntry,
} from './types'

const boardKey = () => ['board', OUTLET_ID, apiScopeKey()] as const

export type Freshness = 'loading' | 'live' | 'delayed' | 'offline'

interface BoardValue {
  board: Board | undefined
  entries: TableBoardEntry[]
  byId: Map<string, TableBoardEntry>
  /** 1-based position of each table in the server's clearing order. */
  queuePosition: Map<string, number>
  freshness: Freshness
  lastUpdated: number | null
  /** Estimated current server time, for elapsed-time display. */
  serverNow: number
  firstLoadError: Error | null
  refetch: () => void
}

const BoardContext = createContext<BoardValue | null>(null)

export function BoardProvider({ children, pollMs = POLL_MS }: { children: ReactNode; pollMs?: number }) {
  const query = useQuery({
    queryKey: boardKey(),
    queryFn: ({ signal }) => request<Board>(`/outlets/${OUTLET_ID}/board`, { signal }),
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const now = useNow(1000)

  const offsetRef = useRef(0)
  if (query.data && query.dataUpdatedAt) {
    offsetRef.current = serverOffsetMs(query.data.generated_at, query.dataUpdatedAt)
  }

  const value = useMemo<BoardValue>(() => {
    const board = query.data
    const entries = board
      ? [...board.tables].sort((a, b) => compareTableIds(a.table.table_id, b.table.table_id))
      : []
    const byId = new Map(entries.map((e) => [e.table.table_id, e]))
    const queuePosition = new Map(
      (board?.clearing_queue ?? []).map((e, i) => [e.table.table_id, i + 1] as const),
    )
    const lastUpdated = query.dataUpdatedAt || null
    const age = lastUpdated ? now - lastUpdated : Infinity
    let freshness: Freshness = 'live'
    if (!board) freshness = query.isError ? 'offline' : 'loading'
    else if (age > OFFLINE_AFTER_MS) freshness = 'offline'
    else if (age > DELAYED_AFTER_MS) freshness = 'delayed'

    return {
      board,
      entries,
      byId,
      queuePosition,
      freshness,
      lastUpdated,
      serverNow: now + offsetRef.current,
      firstLoadError: !board && query.error ? query.error : null,
      refetch: () => void query.refetch(),
    }
  }, [query.data, query.dataUpdatedAt, query.isError, query.error, now, query.refetch])

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
}

export function useBoard(): BoardValue {
  const value = useContext(BoardContext)
  if (!value) throw new Error('useBoard must be used inside BoardProvider')
  return value
}

/** Table and task steps, plus the host's waitlist and seating actions. */
export type ActionInput =
  | StepInput
  | { kind: 'party-create'; request: CreatePartyRequest }
  | { kind: 'party'; partyId: string; queueCode: string; request: PartyActionRequest }
  | { kind: 'hold-create'; tableId: string; request: CreateHoldRequest }
  | { kind: 'hold'; tableId: string; holdId: string; request: HoldActionRequest }

export interface RunOptions {
  /** Toast text on success, e.g. "T4 claimed". Matches the button label's verb. */
  success: string
  /** Called after the server confirms, e.g. to close a dialog. */
  onSuccess?: () => void
  /** Return true when the caller handles the error itself (no toast), e.g. an override prompt. */
  onError?: (error: unknown) => boolean
}

interface MutationVars {
  input: ActionInput
  key: string
  options: RunOptions
}

/** `crypto.randomUUID` only exists in secure contexts; a tablet on the LAN may load over http. */
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function actionId(input: ActionInput | { tableId: string; request: { action: string } }): string {
  if ('kind' in input) {
    switch (input.kind) {
      case 'party-create':
        return 'party:create'
      case 'party':
        return `party:${input.partyId}:${input.request.action}`
      case 'hold-create':
        return `hold:${input.request.party_id}:${input.tableId}`
      case 'hold':
        return `hold:${input.holdId}:${input.request.action}`
    }
  }
  return `${input.tableId}:${input.request.action}`
}

/** What an error message should name: the table, or the party's queue code. */
function subjectOf(input: ActionInput): string {
  if (input.kind === 'party-create') return input.request.queue_code
  if (input.kind === 'party') return input.queueCode
  return input.tableId
}

function pathOf(input: ActionInput): string {
  switch (input.kind) {
    case 'table':
      return `/tables/${encodeURIComponent(input.tableId)}/actions`
    case 'task':
      return `/tasks/${encodeURIComponent(input.taskId)}/actions`
    case 'party-create':
      return '/parties'
    case 'party':
      return `/parties/${encodeURIComponent(input.partyId)}/actions`
    case 'hold-create':
      return '/seating-holds'
    case 'hold':
      return `/seating-holds/${encodeURIComponent(input.holdId)}/actions`
  }
}

type ActionResult = TableBoardEntry | SeatingResult | QueueParty

/** The table entry an action returned, if any, so the cache can update before the next poll. */
function entryOf(input: ActionInput, result: ActionResult): TableBoardEntry | null {
  if (input.kind === 'table' || input.kind === 'task') return result as TableBoardEntry
  if (input.kind === 'hold-create' || input.kind === 'hold') return (result as SeatingResult).table
  return null
}

/** Runs table, task, waitlist and seating actions with idempotency, version checks, and consistent feedback. */
export function useActions() {
  const queryClient = useQueryClient()
  const { actor } = useIdentity()
  const { freshness } = useBoard()

  const mutation = useMutation({
    mutationFn: ({ input, key }: MutationVars) =>
      request<ActionResult>(pathOf(input), {
        method: 'POST',
        body: input.request,
        actor,
        idempotencyKey: key,
      }),
    // Retrying reuses the same variables, so the same idempotency key: the API applies it once.
    retry: (count, error) => error instanceof NetworkError && count < 1,
    onSuccess: (result, { input, options }) => {
      const entry = entryOf(input, result)
      if (entry) {
        queryClient.setQueryData<Board>(boardKey(), (board) =>
          board
            ? {
                ...board,
                tables: board.tables.map((e) => (e.table.table_id === entry.table.table_id ? entry : e)),
              }
            : board,
        )
      }
      void queryClient.invalidateQueries({ queryKey: boardKey() })
      void queryClient.invalidateQueries({ queryKey: ['recommendation'] })
      toast.success(options.success)
    },
    onError: (error, { input, options }) => {
      void queryClient.invalidateQueries({ queryKey: boardKey() })
      void queryClient.invalidateQueries({ queryKey: ['recommendation'] })
      if (options.onError?.(error)) return
      toast.error(describeError(error, subjectOf(input)))
    },
  })

  const run = useCallback(
    (input: ActionInput, options: RunOptions) => {
      mutation.mutate({ input, key: newIdempotencyKey(), options }, { onSuccess: () => options.onSuccess?.() })
    },
    [mutation],
  )

  const pending = mutation.isPending && mutation.variables ? actionId(mutation.variables.input) : null

  return {
    run,
    pending,
    busy: mutation.isPending,
    /** Actions are paused while the board can't be trusted to be current (PRD FR10). */
    paused: freshness === 'offline' || freshness === 'loading',
    lastError: mutation.error,
  }
}

/** `tableId` names the subject: a table, or a party's queue code for waitlist actions. */
export function describeError(error: unknown, tableId: string): string {
  if (error instanceof NetworkError) {
    return `Can't reach TurnWise, so ${tableId} was not changed. Try again when the connection returns.`
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'version_conflict':
        return `${tableId} changed while you were looking. The board has been refreshed. Check it and try again.`
      case 'task_not_claimable':
        return `${tableId} was just claimed by someone else. The board has been refreshed.`
      case 'not_task_owner':
        return `Only the person who claimed ${tableId}, or a manager, can do that.`
      case 'not_found':
        return `${tableId} no longer exists. The board has been refreshed.`
      case 'reason_required':
        return 'Add a reason before saving.'
      case 'queue_code_in_use':
        return `${tableId} is already on the waitlist. Use another code.`
      case 'party_not_waiting':
        return `${error.message} The board has been refreshed.`
      case 'hold_not_active':
        return 'That hold has ended. The board has been refreshed.'
      default:
        return error.message
    }
  }
  return 'Something went wrong. The board has been refreshed.'
}
