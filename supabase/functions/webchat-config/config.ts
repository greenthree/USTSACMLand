import type { WebChatGlobalBudgetUsageView, WebChatRelayConfigView } from './handler.ts'

interface RecordLike {
  [key: string]: unknown
}

function asRecord(value: unknown): RecordLike {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('WebChat relay configuration RPC returned invalid data')
  }
  return row as RecordLike
}

function nonnegativeVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('WebChat relay configuration RPC returned an invalid version')
  }
  return value
}

export function parseWebChatRelayConfigView(value: unknown): WebChatRelayConfigView {
  const row = asRecord(value)
  if (
    (row.base_url !== null && typeof row.base_url !== 'string') ||
    (row.model !== null && typeof row.model !== 'string') ||
    typeof row.api_key_configured !== 'boolean' ||
    typeof row.requests_enabled !== 'boolean' ||
    typeof row.global_daily_request_limit !== 'number' ||
    !Number.isSafeInteger(row.global_daily_request_limit) ||
    row.global_daily_request_limit < 1 ||
    typeof row.global_daily_token_limit !== 'number' ||
    !Number.isSafeInteger(row.global_daily_token_limit) ||
    row.global_daily_token_limit < 100 ||
    typeof row.updated_at !== 'string' ||
    row.updated_at.length < 1
  ) {
    throw new Error('WebChat relay configuration RPC returned invalid data')
  }
  return {
    baseUrl: row.base_url ?? '',
    model: row.model ?? '',
    apiKeyConfigured: row.api_key_configured,
    requestsEnabled: row.requests_enabled,
    globalDailyRequestLimit: row.global_daily_request_limit,
    globalDailyTokenLimit: row.global_daily_token_limit,
    version: nonnegativeVersion(row.version),
    updatedAt: row.updated_at,
  }
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`WebChat budget usage RPC returned invalid ${name}`)
  }
  return value
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`WebChat budget usage RPC returned invalid ${name}`)
  }
  return value
}

export function parseWebChatGlobalBudgetUsageView(value: unknown): WebChatGlobalBudgetUsageView {
  const row = asRecord(value)
  if (
    typeof row.usage_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.usage_date) ||
    (row.request_budget_alerted_at !== null && typeof row.request_budget_alerted_at !== 'string') ||
    (row.token_budget_alerted_at !== null && typeof row.token_budget_alerted_at !== 'string')
  ) {
    throw new Error('WebChat budget usage RPC returned invalid data')
  }

  return {
    usageDate: row.usage_date,
    requestCount: nonnegativeInteger(row.request_count, 'request count'),
    settledTokens: nonnegativeInteger(row.settled_tokens, 'settled tokens'),
    reservedTokens: nonnegativeInteger(row.reserved_tokens, 'reserved tokens'),
    resetAt: timestamp(row.reset_at, 'reset timestamp'),
    requestBudgetAlertedAt:
      row.request_budget_alerted_at === null
        ? null
        : timestamp(row.request_budget_alerted_at, 'request alert timestamp'),
    tokenBudgetAlertedAt:
      row.token_budget_alerted_at === null
        ? null
        : timestamp(row.token_budget_alerted_at, 'token alert timestamp'),
  }
}

export function retryAfterFromDatabaseError(details: string | null | undefined): number {
  if (!details) return 60
  try {
    const parsed = JSON.parse(details) as { retry_after_seconds?: unknown }
    const seconds = Number(parsed.retry_after_seconds)
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
  } catch {
    return 60
  }
}
