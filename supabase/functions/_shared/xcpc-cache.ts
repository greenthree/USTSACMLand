import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTextWithRetry, HttpError, toAdapterHttpError } from './http.ts'
import {
  computeXcpcHistoricalMaxRating,
  normalizeXcpcIdentityPart,
  parseXcpcDataset,
  XCPC_TARGET_ORGANIZATION,
  type XcpcDataset,
  type XcpcDatasetLoader,
  type XcpcPlayer,
} from './adapters/xcpc-elo.ts'
import type { AdapterErrorCode } from './adapters/types.ts'

const DEFAULT_DATA_URL = 'https://zzzzzzyt.github.io/xcpc-elo/data.js'
const DEFAULT_CACHE_TTL_SECONDS = 6 * 60 * 60
const DEFAULT_LEASE_SECONDS = 300
const DEFAULT_RETRY_SECONDS = 5 * 60
const DEFAULT_WAIT_MS = 120_000
const DEFAULT_POLL_MS = 500
const DEFAULT_MAX_SOURCE_BYTES = 32 * 1024 * 1024
const DEFAULT_MIN_SOURCE_PLAYERS = 1_000

const ADAPTER_ERROR_CODES = new Set<AdapterErrorCode>([
  'auth_required',
  'auth_expired',
  'external_worker_required',
  'invalid_account',
  'not_configured',
  'not_found',
  'rate_limited',
  'schema_changed',
  'source_unavailable',
  'timeout',
  'unknown',
])

export interface XcpcCacheSnapshot {
  activeVersion: number
  etag: string | null
  lastModified: string | null
  sourceGeneratedAt: string | null
  validatedAt: string | null
  expiresAt: string | null
  refreshLeaseExpiresAt: string | null
  refreshRetryAfter: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  players: XcpcPlayer[]
}

export interface XcpcCacheAcquireResult {
  acquired: boolean
  reason: 'acquired' | 'fresh' | 'leased' | 'cooldown'
  activeVersion: number
  etag: string | null
  lastModified: string | null
  expiresAt: string | null
  refreshLeaseExpiresAt: string | null
  refreshRetryAfter: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export interface XcpcCachedPlayerRecord {
  player_id: string
  normalized_name: string
  display_name: string
  organization: string
  rating: number
  max_rating: number | null
  contests: number | null
}

export interface XcpcCacheStore {
  read(): Promise<XcpcCacheSnapshot>
  acquire(owner: string, ttlSeconds: number, leaseSeconds: number): Promise<XcpcCacheAcquireResult>
  commitModified(owner: string, ttlSeconds: number, source: XcpcModifiedSource): Promise<number>
  commitNotModified(
    owner: string,
    ttlSeconds: number,
    source: XcpcNotModifiedSource,
  ): Promise<number>
  fail(owner: string, code: AdapterErrorCode, message: string, retrySeconds: number): Promise<void>
}

export interface XcpcCacheOptions {
  ttlSeconds: number
  leaseSeconds: number
  retrySeconds: number
  waitMs: number
  pollMs: number
  now?: () => number
}

export interface XcpcSourceMetadata {
  etag: string | null
  lastModified: string | null
}

export interface XcpcNotModifiedSource {
  kind: 'not_modified'
  etag: string | null
  lastModified: string | null
}

export interface XcpcModifiedSource {
  kind: 'modified'
  etag: string | null
  lastModified: string | null
  sourceGeneratedAt: string
  players: XcpcCachedPlayerRecord[]
}

export type XcpcRemoteSource = XcpcNotModifiedSource | XcpcModifiedSource
export type XcpcSourceLoader = (
  metadata: XcpcSourceMetadata,
  signal?: AbortSignal,
) => Promise<XcpcRemoteSource>

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(Deno.env.get(name))
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requiredVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new HttpError('XCPC ELO cache version is invalid', 'schema_changed', false)
  }
  return Number(value)
}

function parseSnapshot(value: unknown): XcpcCacheSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError('XCPC ELO cache response is invalid', 'schema_changed', false)
  }
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.players)) {
    throw new HttpError('XCPC ELO cached players are missing', 'schema_changed', false)
  }
  return {
    activeVersion: requiredVersion(row.activeVersion),
    etag: optionalString(row.etag),
    lastModified: optionalString(row.lastModified),
    sourceGeneratedAt: optionalString(row.sourceGeneratedAt),
    validatedAt: optionalString(row.validatedAt),
    expiresAt: optionalString(row.expiresAt),
    refreshLeaseExpiresAt: optionalString(row.refreshLeaseExpiresAt),
    refreshRetryAfter: optionalString(row.refreshRetryAfter),
    lastErrorCode: optionalString(row.lastErrorCode),
    lastErrorMessage: optionalString(row.lastErrorMessage),
    players: row.players as XcpcPlayer[],
  }
}

function parseAcquireResult(value: unknown): XcpcCacheAcquireResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError('XCPC ELO cache lease response is invalid', 'schema_changed', false)
  }
  const row = value as Record<string, unknown>
  if (
    typeof row.acquired !== 'boolean' ||
    !['acquired', 'fresh', 'leased', 'cooldown'].includes(String(row.reason))
  ) {
    throw new HttpError('XCPC ELO cache lease fields are invalid', 'schema_changed', false)
  }
  return {
    acquired: row.acquired,
    reason: row.reason as XcpcCacheAcquireResult['reason'],
    activeVersion: requiredVersion(row.activeVersion),
    etag: optionalString(row.etag),
    lastModified: optionalString(row.lastModified),
    expiresAt: optionalString(row.expiresAt),
    refreshLeaseExpiresAt: optionalString(row.refreshLeaseExpiresAt),
    refreshRetryAfter: optionalString(row.refreshRetryAfter),
    lastErrorCode: optionalString(row.lastErrorCode),
    lastErrorMessage: optionalString(row.lastErrorMessage),
  }
}

function databaseFailure(operation: string, error: { code?: string; message: string }): HttpError {
  return new HttpError(
    `Could not ${operation}: ${error.message}`,
    'source_unavailable',
    true,
    undefined,
    undefined,
    error.code ? { databaseCode: error.code } : undefined,
  )
}

export function createSupabaseXcpcCacheStore(client: SupabaseClient): XcpcCacheStore {
  return {
    async read() {
      const { data, error } = await client.rpc('read_xcpc_elo_cache')
      if (error) throw databaseFailure('read the XCPC ELO cache', error)
      return parseSnapshot(data)
    },

    async acquire(owner, ttlSeconds, leaseSeconds) {
      const { data, error } = await client.rpc('acquire_xcpc_elo_cache_refresh', {
        requested_owner: owner,
        cache_ttl_seconds: ttlSeconds,
        lease_seconds: leaseSeconds,
      })
      if (error) throw databaseFailure('acquire the XCPC ELO cache refresh lease', error)
      return parseAcquireResult(data)
    },

    async commitModified(owner, ttlSeconds, source) {
      const { data, error } = await client.rpc('commit_xcpc_elo_cache_refresh', {
        requested_owner: owner,
        cache_ttl_seconds: ttlSeconds,
        response_etag: source.etag,
        response_last_modified: source.lastModified,
        response_source_generated_at: source.sourceGeneratedAt,
        response_players: source.players,
      })
      if (error) throw databaseFailure('commit the XCPC ELO cache refresh', error)
      return requiredVersion(data)
    },

    async commitNotModified(owner, ttlSeconds, source) {
      const { data, error } = await client.rpc('validate_xcpc_elo_cache_refresh', {
        requested_owner: owner,
        cache_ttl_seconds: ttlSeconds,
        response_etag: source.etag,
        response_last_modified: source.lastModified,
      })
      if (error) throw databaseFailure('validate the XCPC ELO cache', error)
      return requiredVersion(data)
    },

    async fail(owner, code, message, retrySeconds) {
      const { error } = await client.rpc('fail_xcpc_elo_cache_refresh', {
        requested_owner: owner,
        failure_code: code,
        failure_message: message,
        retry_after_seconds: retrySeconds,
      })
      if (error) throw databaseFailure('record the XCPC ELO cache failure', error)
    },
  }
}

function sourceTimestamp(value: string | undefined): string {
  if (!value) {
    throw new HttpError('XCPC ELO source generation time is missing', 'schema_changed', false)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new HttpError('XCPC ELO source generation time is invalid', 'schema_changed', false)
  }
  return new Date(timestamp).toISOString()
}

export function prepareXcpcCachedPlayers(
  dataset: XcpcDataset,
  minimumSourcePlayers = DEFAULT_MIN_SOURCE_PLAYERS,
): XcpcCachedPlayerRecord[] {
  const players = dataset.players
  if (!Array.isArray(players) || players.length < minimumSourcePlayers) {
    throw new HttpError(
      `XCPC ELO source contains fewer than ${minimumSourcePlayers} players`,
      'schema_changed',
      false,
    )
  }

  const targetOrganization = normalizeXcpcIdentityPart(XCPC_TARGET_ORGANIZATION)
  const records: XcpcCachedPlayerRecord[] = []
  const ids = new Set<string>()
  for (const player of players) {
    if (normalizeXcpcIdentityPart(player.organization) !== targetOrganization) continue

    const displayName = normalizeXcpcIdentityPart(player.teamMember)
    if (!/^xcpc_[a-f0-9]{16}$/i.test(player.id) || !displayName) {
      throw new HttpError('XCPC ELO target player identity is invalid', 'schema_changed', false)
    }
    if (ids.has(player.id)) {
      throw new HttpError('XCPC ELO target player IDs are not unique', 'schema_changed', false)
    }
    if (!Number.isSafeInteger(player.rating)) {
      throw new HttpError('XCPC ELO target player rating is invalid', 'schema_changed', false)
    }
    if (
      player.contests !== undefined &&
      (!Number.isSafeInteger(player.contests) || player.contests < 0)
    ) {
      throw new HttpError(
        'XCPC ELO target player contest count is invalid',
        'schema_changed',
        false,
      )
    }

    const maxRating = computeXcpcHistoricalMaxRating(player)
    records.push({
      player_id: player.id,
      normalized_name: displayName,
      display_name: displayName,
      organization: XCPC_TARGET_ORGANIZATION,
      rating: player.rating!,
      max_rating: maxRating,
      contests: player.contests ?? null,
    })
    ids.add(player.id)
  }

  if (records.length === 0) {
    throw new HttpError(
      `XCPC ELO source contains no players from ${XCPC_TARGET_ORGANIZATION}`,
      'schema_changed',
      false,
    )
  }
  return records
}

export async function loadXcpcRemoteSource(
  metadata: XcpcSourceMetadata,
  signal?: AbortSignal,
  options: {
    url?: string
    maximumBytes?: number
    minimumSourcePlayers?: number
    fetcher?: typeof fetch
  } = {},
): Promise<XcpcRemoteSource> {
  const headers = new Headers({
    accept: 'text/javascript, application/javascript;q=0.9, */*;q=0.1',
  })
  if (metadata.etag) headers.set('if-none-match', metadata.etag)
  if (metadata.lastModified) headers.set('if-modified-since', metadata.lastModified)
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAX_SOURCE_BYTES

  const fetched = await fetchTextWithRetry(
    options.url ?? Deno.env.get('XCPC_ELO_DATA_URL') ?? DEFAULT_DATA_URL,
    {
      headers,
      signal,
      timeoutMs: 45_000,
      retries: 1,
      acceptedStatuses: [304],
      fetcher: options.fetcher,
      maxResponseBytes: maximumBytes,
    },
  )
  const { response } = fetched
  const etag = response.headers.get('etag')
  const lastModified = response.headers.get('last-modified')
  if (response.status === 304) {
    return { kind: 'not_modified', etag, lastModified }
  }

  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new HttpError(
      'XCPC ELO source exceeds the configured size limit',
      'schema_changed',
      false,
    )
  }

  const script = fetched.text
  if (new TextEncoder().encode(script).byteLength > maximumBytes) {
    throw new HttpError(
      'XCPC ELO source exceeds the configured size limit',
      'schema_changed',
      false,
    )
  }
  const dataset = parseXcpcDataset(script)
  return {
    kind: 'modified',
    etag,
    lastModified,
    sourceGeneratedAt: sourceTimestamp(dataset.generatedAt),
    players: prepareXcpcCachedPlayers(
      dataset,
      options.minimumSourcePlayers ?? DEFAULT_MIN_SOURCE_PLAYERS,
    ),
  }
}

function isFresh(snapshot: XcpcCacheSnapshot, now: number): boolean {
  return (
    snapshot.activeVersion > 0 &&
    snapshot.players.length > 0 &&
    snapshot.expiresAt !== null &&
    Date.parse(snapshot.expiresAt) > now
  )
}

function snapshotDataset(snapshot: XcpcCacheSnapshot): XcpcDataset {
  if (snapshot.activeVersion <= 0 || !snapshot.sourceGeneratedAt || snapshot.players.length === 0) {
    throw new HttpError('XCPC ELO cache is incomplete', 'schema_changed', false)
  }
  if (!Number.isFinite(Date.parse(snapshot.sourceGeneratedAt))) {
    throw new HttpError('XCPC ELO cached source time is invalid', 'schema_changed', false)
  }
  return {
    generatedAt: snapshot.sourceGeneratedAt,
    cacheVersion: snapshot.activeVersion,
    players: snapshot.players,
  }
}

function cooldownError(lease: XcpcCacheAcquireResult): HttpError {
  const code = ADAPTER_ERROR_CODES.has(lease.lastErrorCode as AdapterErrorCode)
    ? (lease.lastErrorCode as AdapterErrorCode)
    : 'source_unavailable'
  return new HttpError(
    lease.lastErrorMessage ?? 'XCPC ELO refresh is cooling down after an upstream failure',
    code,
    ['rate_limited', 'source_unavailable', 'timeout'].includes(code),
    undefined,
    undefined,
    lease.refreshRetryAfter ? { retryAfter: lease.refreshRetryAfter } : undefined,
  )
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

export function createXcpcSharedCacheLoader(
  store: XcpcCacheStore,
  loadSource: XcpcSourceLoader,
  options: XcpcCacheOptions,
): XcpcDatasetLoader {
  if (
    options.ttlSeconds < 60 ||
    options.leaseSeconds < 30 ||
    options.retrySeconds < 30 ||
    options.waitMs <= 0 ||
    options.pollMs <= 0
  ) {
    throw new Error('Invalid XCPC ELO shared cache configuration')
  }

  const now = options.now ?? Date.now
  return async (signal?: AbortSignal) => {
    const deadline = now() + options.waitMs
    const owner = crypto.randomUUID()

    while (true) {
      const snapshot = await store.read()
      if (isFresh(snapshot, now())) return snapshotDataset(snapshot)

      const lease = await store.acquire(owner, options.ttlSeconds, options.leaseSeconds)
      if (lease.reason === 'cooldown') throw cooldownError(lease)
      if (lease.reason === 'fresh') {
        const freshSnapshot = await store.read()
        if (isFresh(freshSnapshot, now())) return snapshotDataset(freshSnapshot)
      }

      if (lease.acquired) {
        try {
          const source = await loadSource(
            { etag: lease.etag, lastModified: lease.lastModified },
            signal,
          )
          if (source.kind === 'modified') {
            await store.commitModified(owner, options.ttlSeconds, source)
          } else {
            await store.commitNotModified(owner, options.ttlSeconds, source)
          }
        } catch (error) {
          const normalized = toAdapterHttpError(error)
          try {
            await store.fail(owner, normalized.code, normalized.message, options.retrySeconds)
          } catch (recordError) {
            throw new AggregateError(
              [error, recordError],
              'XCPC ELO refresh and failure recording both failed',
            )
          }
          throw error
        }

        const refreshed = await store.read()
        if (!isFresh(refreshed, now())) {
          throw new HttpError(
            'XCPC ELO cache refresh did not publish fresh data',
            'schema_changed',
            false,
          )
        }
        return snapshotDataset(refreshed)
      }

      const remaining = deadline - now()
      if (remaining <= 0) {
        throw new HttpError(
          'Timed out waiting for the XCPC ELO cache refresh lease',
          'timeout',
          true,
        )
      }
      await delay(Math.min(options.pollMs, remaining), signal)
    }
  }
}

export function createSupabaseXcpcDatasetLoader(client: SupabaseClient): XcpcDatasetLoader {
  const options: XcpcCacheOptions = {
    ttlSeconds: integerEnv('XCPC_ELO_CACHE_TTL_SECONDS', DEFAULT_CACHE_TTL_SECONDS, 60, 86400),
    leaseSeconds: integerEnv('XCPC_ELO_CACHE_LEASE_SECONDS', DEFAULT_LEASE_SECONDS, 30, 600),
    retrySeconds: integerEnv('XCPC_ELO_CACHE_RETRY_SECONDS', DEFAULT_RETRY_SECONDS, 30, 3600),
    waitMs: integerEnv('XCPC_ELO_CACHE_WAIT_MS', DEFAULT_WAIT_MS, 1_000, 120_000),
    pollMs: integerEnv('XCPC_ELO_CACHE_POLL_MS', DEFAULT_POLL_MS, 100, 5_000),
  }
  const sourceOptions = {
    maximumBytes: integerEnv(
      'XCPC_ELO_MAX_SOURCE_BYTES',
      DEFAULT_MAX_SOURCE_BYTES,
      1_048_576,
      67_108_864,
    ),
    minimumSourcePlayers: integerEnv(
      'XCPC_ELO_MIN_SOURCE_PLAYERS',
      DEFAULT_MIN_SOURCE_PLAYERS,
      1,
      1_000_000,
    ),
  }
  return createXcpcSharedCacheLoader(
    createSupabaseXcpcCacheStore(client),
    (metadata, signal) => loadXcpcRemoteSource(metadata, signal, sourceOptions),
    options,
  )
}
