import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { DELAYED_AFTER_MS, OFFLINE_AFTER_MS, OUTLET_ID, POLL_MS } from '@/config'
import { useIdentity } from '@/lib/identity/dev-identity'
import type { StepInput } from '@/lib/domain/next-step'
import { compareTableIds } from '@/lib/domain/status'
import { serverOffsetMs, useNow } from '@/lib/domain/time'
import { ApiError, NetworkError, request } from './client'
import type { Board, TableBoardEntry } from './types'

const boardKey = ['board', OUTLET_ID] as const

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

export function BoardProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: boardKey,
    queryFn: ({ signal }) => request<Board>(`/outlets/${OUTLET_ID}/board`, { signal }),
    refetchInterval: POLL_MS,
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

type ActionInput = StepInput

export interface RunOptions {
  /** Toast text on success, e.g. "T4 claimed". Matches the button label's verb. */
  success: string
  /** Called after the server confirms, e.g. to close a dialog. */
  onSuccess?: () => void
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

export function actionId(input: { tableId: string; request: { action: string } }): string {
  return `${input.tableId}:${input.request.action}`
}

/** Runs table and task actions with idempotency, version checks, and consistent feedback. */
export function useActions() {
  const queryClient = useQueryClient()
  const { actor } = useIdentity()
  const { freshness } = useBoard()

  const mutation = useMutation({
    mutationFn: ({ input, key }: MutationVars) => {
      const path =
        input.kind === 'table'
          ? `/tables/${encodeURIComponent(input.tableId)}/actions`
          : `/tasks/${encodeURIComponent(input.taskId)}/actions`
      return request<TableBoardEntry>(path, {
        method: 'POST',
        body: input.request,
        actor,
        idempotencyKey: key,
      })
    },
    // Retrying reuses the same variables, so the same idempotency key: the API applies it once.
    retry: (count, error) => error instanceof NetworkError && count < 1,
    onSuccess: (entry, { options }) => {
      queryClient.setQueryData<Board>(boardKey, (board) =>
        board
          ? {
              ...board,
              tables: board.tables.map((e) =>
                e.table.table_id === entry.table.table_id ? entry : e,
              ),
            }
          : board,
      )
      void queryClient.invalidateQueries({ queryKey: boardKey })
      toast.success(options.success)
    },
    onError: (error, { input }) => {
      void queryClient.invalidateQueries({ queryKey: boardKey })
      toast.error(describeError(error, input.tableId))
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
      default:
        return error.message
    }
  }
  return 'Something went wrong. The board has been refreshed.'
}
