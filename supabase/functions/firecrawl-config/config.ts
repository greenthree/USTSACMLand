import type { FirecrawlKeyView } from './handler.ts'

const HEALTH_STATUSES = new Set<FirecrawlKeyView['healthStatus']>([
  'unknown',
  'healthy',
  'warning',
  'critical',
  'degraded',
  'rate_limited',
  'auth_failed',
])

function numberValue(value: unknown, name: string, nullable = false): number | null {
  if (nullable && value === null) return null
  const normalized = typeof value === 'string' ? Number(value) : value
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`Firecrawl key RPC returned invalid ${name}`)
  }
  return normalized
}

function timestamp(value: unknown, name: string, nullable = true): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Firecrawl key RPC returned invalid ${name}`)
  }
  return value
}

export function parseFirecrawlKey(value: unknown): FirecrawlKeyView {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Firecrawl key RPC returned invalid data')
  }
  const data = row as Record<string, unknown>
  if (
    typeof data.id !== 'string' ||
    typeof data.label !== 'string' ||
    typeof data.key_configured !== 'boolean' ||
    typeof data.enabled !== 'boolean' ||
    typeof data.health_status !== 'string' ||
    !HEALTH_STATUSES.has(data.health_status as FirecrawlKeyView['healthStatus']) ||
    (data.last_error_code !== null && typeof data.last_error_code !== 'string')
  ) {
    throw new Error('Firecrawl key RPC returned invalid data')
  }
  return {
    id: data.id,
    label: data.label,
    keyConfigured: data.key_configured,
    enabled: data.enabled,
    priority: numberValue(data.priority, 'priority') as number,
    healthStatus: data.health_status as FirecrawlKeyView['healthStatus'],
    consecutiveFailures: numberValue(data.consecutive_failures, 'failure count') as number,
    cooldownUntil: timestamp(data.cooldown_until, 'cooldown'),
    lastSelectedAt: timestamp(data.last_selected_at, 'last selected'),
    lastCheckedAt: timestamp(data.last_checked_at, 'last checked'),
    lastSuccessAt: timestamp(data.last_success_at, 'last success'),
    lastFailureAt: timestamp(data.last_failure_at, 'last failure'),
    lastErrorCode: data.last_error_code as string | null,
    creditsRemaining: numberValue(data.credits_remaining, 'remaining credits', true),
    creditsTotal: numberValue(data.credits_total, 'total credits', true),
    billingPeriodEnd: timestamp(data.billing_period_end, 'billing period end'),
    version: numberValue(data.version, 'version') as number,
    createdAt: timestamp(data.created_at, 'created timestamp', false) as string,
    updatedAt: timestamp(data.updated_at, 'updated timestamp', false) as string,
  }
}

export function parseFirecrawlKeys(value: unknown): FirecrawlKeyView[] {
  if (!Array.isArray(value)) throw new Error('Firecrawl key list RPC returned invalid data')
  return value.map(parseFirecrawlKey)
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
