export interface WebChatRelayRuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  requestsEnabled: boolean
  globalDailyRequestLimit: number
  globalDailyTokenLimit: number
}

interface RuntimeConfigRow {
  base_url?: unknown
  api_key?: unknown
  model?: unknown
  requests_enabled?: unknown
  global_daily_request_limit?: unknown
  global_daily_token_limit?: unknown
}

function databaseRow(value: unknown): RuntimeConfigRow | null {
  const row = Array.isArray(value) ? value[0] : value
  if (row === undefined || row === null) return null
  if (typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('WebChat runtime configuration RPC returned invalid data')
  }
  return row as RuntimeConfigRow
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function resolveWebChatRelayRuntimeConfig(
  value: unknown,
  environmentFallback: () => WebChatRelayRuntimeConfig,
): WebChatRelayRuntimeConfig {
  const row = databaseRow(value)
  if (!row) return environmentFallback()

  if (
    typeof row.requests_enabled !== 'boolean' ||
    typeof row.global_daily_request_limit !== 'number' ||
    !Number.isSafeInteger(row.global_daily_request_limit) ||
    row.global_daily_request_limit < 1 ||
    typeof row.global_daily_token_limit !== 'number' ||
    !Number.isSafeInteger(row.global_daily_token_limit) ||
    row.global_daily_token_limit < 100
  ) {
    throw new Error('WebChat runtime configuration RPC returned invalid data')
  }

  for (const field of [row.base_url, row.api_key, row.model]) {
    if (field !== null && field !== undefined && typeof field !== 'string') {
      throw new Error('WebChat runtime configuration RPC returned invalid data')
    }
  }

  // The singleton row is the authoritative kill switch and budget source as
  // soon as the database migration exists. An unconfigured, paused row must
  // never inherit requestsEnabled=true from the environment fallback.
  if (!row.requests_enabled) {
    return {
      baseUrl: nonempty(row.base_url) ? row.base_url.trim() : '',
      apiKey: nonempty(row.api_key) ? row.api_key.trim() : '',
      model: nonempty(row.model) ? row.model.trim() : '',
      requestsEnabled: false,
      globalDailyRequestLimit: row.global_daily_request_limit,
      globalDailyTokenLimit: row.global_daily_token_limit,
    }
  }

  if (!nonempty(row.base_url) || !nonempty(row.api_key) || !nonempty(row.model)) {
    throw new Error('WebChat relay configuration is incomplete')
  }

  return {
    baseUrl: row.base_url.trim(),
    apiKey: row.api_key.trim(),
    model: row.model.trim(),
    requestsEnabled: row.requests_enabled,
    globalDailyRequestLimit: row.global_daily_request_limit,
    globalDailyTokenLimit: row.global_daily_token_limit,
  }
}
