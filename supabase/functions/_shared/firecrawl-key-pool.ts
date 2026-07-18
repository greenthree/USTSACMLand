import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from './http.ts'

export type FirecrawlRuntimePurpose = 'qoj' | 'nowcoder'
export type FirecrawlObservationPurpose = FirecrawlRuntimePurpose | 'credit_monitor' | 'admin_check'

export interface FirecrawlRuntimeKey {
  keyId: string | null
  apiKey: string
  apiUrl: string
  source: 'database' | 'environment'
}

export interface FirecrawlCreditObservation {
  remainingCredits: number
  planCredits: number
  billingPeriodEnd: string | null
  severity: 'warning' | 'critical' | null
}

interface RuntimeKeyRow {
  pool_configured: boolean
  key_id: string | null
  api_key: string | null
}

function runtimeRows(value: unknown): RuntimeKeyRow[] {
  if (!Array.isArray(value)) throw new Error('Firecrawl key pool returned invalid data')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Firecrawl key pool returned invalid data')
    }
    const row = entry as Record<string, unknown>
    if (
      typeof row.pool_configured !== 'boolean' ||
      (row.key_id !== null && typeof row.key_id !== 'string') ||
      (row.api_key !== null && typeof row.api_key !== 'string')
    ) {
      throw new Error('Firecrawl key pool returned invalid data')
    }
    if ((row.key_id === null) !== (row.api_key === null)) {
      throw new Error('Firecrawl key pool returned incomplete data')
    }
    return row as unknown as RuntimeKeyRow
  })
}

function firecrawlApiUrl(): string {
  const url = new URL(Deno.env.get('FIRECRAWL_API_URL')?.trim() || 'https://api.firecrawl.dev')
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('FIRECRAWL_API_URL must be a credential-free HTTPS URL')
  }
  return url.toString().replace(/\/$/, '')
}

function environmentKey(): FirecrawlRuntimeKey | null {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY')?.trim()
  return apiKey ? { keyId: null, apiKey, apiUrl: firecrawlApiUrl(), source: 'environment' } : null
}

function databaseKey(row: RuntimeKeyRow): FirecrawlRuntimeKey {
  if (!row.key_id || !row.api_key?.trim()) throw new Error('Firecrawl key pool returned no key')
  return {
    keyId: row.key_id,
    apiKey: row.api_key.trim(),
    apiUrl: firecrawlApiUrl(),
    source: 'database',
  }
}

export async function selectFirecrawlRuntimeKey(
  client: SupabaseClient,
  purpose: FirecrawlRuntimePurpose,
  operationId: string | null = null,
): Promise<FirecrawlRuntimeKey | null> {
  const { data, error } = await client.rpc('select_firecrawl_runtime_key', {
    requested_purpose: purpose,
    requested_operation_id: operationId,
  })
  if (error) throw new Error('Could not select a Firecrawl runtime key')
  const rows = runtimeRows(data)
  if (rows.length !== 1) throw new Error('Firecrawl key selection returned invalid data')
  const row = rows[0]
  if (row.key_id) return databaseKey(row)
  return row.pool_configured ? null : environmentKey()
}

export async function listFirecrawlRuntimeKeys(
  client: SupabaseClient,
): Promise<FirecrawlRuntimeKey[]> {
  const { data, error } = await client.rpc('list_firecrawl_runtime_keys')
  if (error) throw new Error('Could not list Firecrawl runtime keys')
  const rows = runtimeRows(data)
  const configuredRows = rows.filter((row) => row.key_id !== null)
  if (configuredRows.length > 0) return configuredRows.map(databaseKey)
  const poolConfigured = rows.some((row) => row.pool_configured)
  const fallback = poolConfigured ? null : environmentKey()
  return fallback ? [fallback] : []
}

export async function readFirecrawlRuntimeKey(
  client: SupabaseClient,
  keyId: string,
): Promise<FirecrawlRuntimeKey | null> {
  const { data, error } = await client.rpc('read_firecrawl_runtime_key', {
    target_key_id: keyId,
  })
  if (error) throw new Error('Could not read the Firecrawl runtime key')
  if (!Array.isArray(data) || data.length === 0) return null
  const row = data[0] as Record<string, unknown>
  if (typeof row.key_id !== 'string' || typeof row.api_key !== 'string' || !row.api_key.trim()) {
    throw new Error('Firecrawl runtime key returned invalid data')
  }
  return {
    keyId: row.key_id,
    apiKey: row.api_key.trim(),
    apiUrl: firecrawlApiUrl(),
    source: 'database',
  }
}

export function firecrawlKeyFailureCode(error: unknown): string | null {
  if (error instanceof HttpError) {
    const authTarget = error.details?.authTarget
    if (
      authTarget === 'firecrawl' &&
      (error.code === 'auth_required' || error.code === 'auth_expired')
    ) {
      return error.code
    }
    if (error.status === 401) return 'auth_expired'
    if (error.status === 403) return 'auth_required'
    if (error.status === 429) return 'rate_limited'
    if (error.status !== undefined && error.status >= 500) return 'source_unavailable'
    if (error.code === 'timeout') return error.code
    return null
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  if (error instanceof TypeError) return 'network_error'
  return null
}

export async function recordFirecrawlObservation(
  client: SupabaseClient,
  key: FirecrawlRuntimeKey,
  purpose: FirecrawlObservationPurpose,
  success: boolean,
  errorCode: string | null = null,
  credit: FirecrawlCreditObservation | null = null,
): Promise<void> {
  if (!key.keyId) return
  const { error } = await client.rpc('record_firecrawl_key_observation', {
    target_key_id: key.keyId,
    requested_purpose: purpose,
    observed_success: success,
    observed_error_code: errorCode,
    observed_credits_remaining: credit?.remainingCredits ?? null,
    observed_credits_total: credit?.planCredits ?? null,
    observed_billing_period_end: credit?.billingPeriodEnd ?? null,
    observed_severity: credit?.severity ?? null,
  })
  if (error) throw new Error('Could not record Firecrawl key health')
}

export async function observeFirecrawlOperation<T>(
  client: SupabaseClient,
  key: FirecrawlRuntimeKey,
  purpose: FirecrawlRuntimePurpose,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation()
    await recordFirecrawlObservation(client, key, purpose, true).catch(() => {
      console.warn(JSON.stringify({ event: 'firecrawl_key_observation_failed', purpose }))
    })
    return result
  } catch (error) {
    const failureCode = firecrawlKeyFailureCode(error)
    await recordFirecrawlObservation(client, key, purpose, failureCode === null, failureCode).catch(
      () => {
        console.warn(JSON.stringify({ event: 'firecrawl_key_observation_failed', purpose }))
      },
    )
    throw error
  }
}
