export const PLATFORM_IDS = [
  'codeforces',
  'nowcoder',
  'atcoder',
  'xcpc_elo',
  'luogu',
  'qoj',
] as const

export type PlatformId = (typeof PLATFORM_IDS)[number]

export type AdapterErrorCode =
  | 'auth_required'
  | 'auth_expired'
  | 'external_worker_required'
  | 'invalid_account'
  | 'not_configured'
  | 'not_found'
  | 'rate_limited'
  | 'schema_changed'
  | 'source_unavailable'
  | 'timeout'
  | 'unknown'

export interface PlatformMetrics {
  currentRating: number | null
  maxRating: number | null
  solvedCount: number | null
}

export interface AdapterSuccess {
  ok: true
  platform: PlatformId
  accountId: string
  metrics: PlatformMetrics
  fetchedAt: string
  sourceUpdatedAt: string | null
  sourceVersion: string | null
  details?: Record<string, unknown>
}

export interface AdapterFailure {
  ok: false
  platform: PlatformId
  accountId: string
  error: {
    code: AdapterErrorCode
    message: string
    retryable: boolean
    details?: Record<string, unknown>
  }
  fetchedAt: string
}

export type AdapterResult = AdapterSuccess | AdapterFailure

export interface AdapterContext {
  signal?: AbortSignal
  memberName?: string
}

export interface PlatformAdapter {
  readonly platform: PlatformId
  sync(accountId: string, context?: AdapterContext): Promise<AdapterResult>
}

export function success(
  platform: PlatformId,
  accountId: string,
  metrics: PlatformMetrics,
  options: Omit<AdapterSuccess, 'ok' | 'platform' | 'accountId' | 'metrics' | 'fetchedAt'> & {
    fetchedAt?: string
  } = { sourceUpdatedAt: null, sourceVersion: null },
): AdapterSuccess {
  return {
    ok: true,
    platform,
    accountId,
    metrics,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    sourceUpdatedAt: options.sourceUpdatedAt,
    sourceVersion: options.sourceVersion,
    details: options.details,
  }
}

export function failure(
  platform: PlatformId,
  accountId: string,
  code: AdapterErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): AdapterFailure {
  return {
    ok: false,
    platform,
    accountId,
    error: { code, message, retryable, details },
    fetchedAt: new Date().toISOString(),
  }
}
