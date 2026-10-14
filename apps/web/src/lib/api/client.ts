import type { UserRole } from './types'
import { DEMO_IDENTITY } from '@/config'

export interface Actor {
  id: string
  role: UserRole
}

/** A failed API call, normalised from `{code, message}` or FastAPI's `{detail}` bodies. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** The request never reached the API (offline, proxy down, API stopped). */
export class NetworkError extends Error {
  constructor() {
    super("Can't reach TurnWise. Check that the API is running.")
    this.name = 'NetworkError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  actor?: Actor | null
  idempotencyKey?: string
  signal?: AbortSignal
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  // Header identity for development and the no-sign-in demo build (DEMO_IDENTITY).
  if (DEMO_IDENTITY && options.actor) {
    headers['X-Actor-Id'] = options.actor.id
    headers['X-Actor-Role'] = options.actor.role
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new NetworkError()
  }

  // The Vite proxy answers 502/503/504 when the API process is down.
  if (response.status >= 502 && response.status <= 504) throw new NetworkError()

  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error body; fall through to a generic message.
  }

  if (isRecord(body) && typeof body.code === 'string' && typeof body.message === 'string') {
    return new ApiError(response.status, body.code, body.message)
  }

  if (isRecord(body) && Array.isArray(body.detail)) {
    if (import.meta.env.DEV) console.warn('Request validation failed', body.detail)
    const missingIdentity = body.detail.some(
      (item) => isRecord(item) && Array.isArray(item.loc) && item.loc.includes('header'),
    )
    return new ApiError(
      response.status,
      missingIdentity ? 'identity_required' : 'validation_error',
      missingIdentity
        ? 'Sign-in is not available in this build yet, so changes cannot be saved.'
        : 'The request was missing required details.',
    )
  }

  return new ApiError(response.status, 'unknown_error', `The API returned ${response.status}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
