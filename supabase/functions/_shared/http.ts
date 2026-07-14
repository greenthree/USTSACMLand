import type { AdapterErrorCode } from './adapters/types.ts'

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  retryBaseMs?: number
  retryMaxMs?: number
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly code: AdapterErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
    readonly responseBody?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null

  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)

  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

function statusCode(status: number): AdapterErrorCode {
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  return 'source_unavailable'
}

function abortSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  )
  const onAbort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', onAbort, { once: true })

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      parent?.removeEventListener('abort', onAbort)
    },
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export async function fetchWithRetry(
  input: string | URL | Request,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 12_000,
    retries = 2,
    retryBaseMs = 350,
    retryMaxMs = 4_000,
    signal: parentSignal,
    ...init
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const scoped = abortSignal(timeoutMs, parentSignal ?? undefined)
    try {
      const response = await fetch(input, { ...init, signal: scoped.signal })
      if (response.ok) return response

      const body = (await response.text()).slice(0, 2_000)
      const retryable = RETRYABLE_STATUS.has(response.status)
      const error = new HttpError(
        `Upstream returned HTTP ${response.status}`,
        statusCode(response.status),
        retryable,
        response.status,
        body,
      )
      lastError = error
      if (!retryable || attempt === retries) throw error

      const delay = Math.min(
        retryMaxMs,
        retryAfterMs(response) ?? retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 150),
      )
      await sleep(delay, parentSignal ?? undefined)
    } catch (error) {
      const isTimeout = scoped.signal.aborted && !parentSignal?.aborted
      const normalized = isTimeout
        ? new HttpError(`Request timed out after ${timeoutMs}ms`, 'timeout', true)
        : error
      lastError = normalized

      const retryable =
        normalized instanceof HttpError ? normalized.retryable : normalized instanceof TypeError
      if (!retryable || attempt === retries) throw normalized

      const delay = Math.min(
        retryMaxMs,
        retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 150),
      )
      await sleep(delay, parentSignal ?? undefined)
    } finally {
      scoped.dispose()
    }
  }

  throw lastError
}

export async function fetchJson<T>(
  input: string | URL | Request,
  options?: FetchWithRetryOptions,
): Promise<T> {
  const response = await fetchWithRetry(input, options)
  try {
    return (await response.json()) as T
  } catch {
    throw new HttpError('Upstream returned invalid JSON', 'schema_changed', false, response.status)
  }
}

export function toAdapterHttpError(error: unknown): {
  code: AdapterErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
} {
  if (error instanceof HttpError) {
    const details = {
      ...(error.status ? { httpStatus: error.status } : {}),
      ...(error.details ?? {}),
    }
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: Object.keys(details).length > 0 ? details : undefined,
    }
  }
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message, retryable: false }
  }
  return {
    code: 'unknown',
    message: 'Unknown adapter error',
    retryable: false,
  }
}
