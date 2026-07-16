import type { AdapterErrorCode, PlatformId } from './adapters/types.ts'

export interface SyncFailureAlert {
  jobId: number
  triggerType: string
  attempt: number
  maxAttempts: number
  failedAt: string
  failures: Array<{
    platform: PlatformId
    code: AdapterErrorCode
  }>
}

export interface FirecrawlCreditAlert {
  checkedAt: string
  remainingCredits: number
  planCredits: number
  percentRemaining: number
  billingPeriodEnd: string | null
  severity: 'warning' | 'critical'
}

export interface AlertDeliveryOptions {
  webhookUrl?: string | null
  webhookToken?: string | null
  timeoutMs?: number
  fetcher?: typeof fetch
}

export interface AlertDeliveryResult {
  configured: boolean
  delivered: boolean
  status: number | null
}

const OPERATIONAL_ALERT_CODES = new Set<AdapterErrorCode>([
  'auth_required',
  'auth_expired',
  'external_worker_required',
  'not_configured',
  'rate_limited',
  'schema_changed',
  'source_unavailable',
  'timeout',
  'unknown',
])

export function shouldNotifySyncFailure(code: AdapterErrorCode): boolean {
  return OPERATIONAL_ALERT_CODES.has(code)
}

function validWebhookUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export async function deliverOperationalAlertPayload(
  payload: Record<string, unknown>,
  options: AlertDeliveryOptions = {},
): Promise<AlertDeliveryResult> {
  const configuredValue = options.webhookUrl ?? Deno.env.get('SYNC_ALERT_WEBHOOK_URL')
  if (!configuredValue?.trim()) {
    return { configured: false, delivered: false, status: null }
  }

  const webhookUrl = validWebhookUrl(configuredValue)
  if (!webhookUrl) {
    throw new Error('SYNC_ALERT_WEBHOOK_URL must be an HTTPS URL without credentials')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000)
  try {
    const token =
      options.webhookToken === undefined
        ? Deno.env.get('SYNC_ALERT_WEBHOOK_TOKEN')
        : options.webhookToken
    const response = await (options.fetcher ?? fetch)(webhookUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return {
      configured: true,
      delivered: response.ok,
      status: response.status,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function deliverSyncFailureAlert(
  alert: SyncFailureAlert,
  options: AlertDeliveryOptions = {},
): Promise<AlertDeliveryResult> {
  return deliverOperationalAlertPayload(
    {
      version: 1,
      event: 'sync_job_failed',
      ...alert,
    },
    options,
  )
}

export function deliverFirecrawlCreditAlert(
  alert: FirecrawlCreditAlert,
  options: AlertDeliveryOptions = {},
): Promise<AlertDeliveryResult> {
  return deliverOperationalAlertPayload(
    {
      version: 1,
      event: 'firecrawl_credit_low',
      ...alert,
    },
    options,
  )
}

export async function notifySyncFailure(alert: SyncFailureAlert): Promise<void> {
  try {
    const result = await deliverSyncFailureAlert(alert)
    if (result.configured && !result.delivered) {
      console.warn(
        JSON.stringify({
          event: 'sync_failure_alert_delivery_failed',
          jobId: alert.jobId,
          status: result.status,
        }),
      )
    }
  } catch {
    console.warn(
      JSON.stringify({
        event: 'sync_failure_alert_delivery_failed',
        jobId: alert.jobId,
        status: null,
      }),
    )
  }
}

export async function notifyFirecrawlCreditAlert(alert: FirecrawlCreditAlert): Promise<void> {
  try {
    const result = await deliverFirecrawlCreditAlert(alert)
    if (result.configured && !result.delivered) {
      console.warn(
        JSON.stringify({
          event: 'firecrawl_credit_alert_delivery_failed',
          severity: alert.severity,
          status: result.status,
        }),
      )
    }
  } catch {
    console.warn(
      JSON.stringify({
        event: 'firecrawl_credit_alert_delivery_failed',
        severity: alert.severity,
        status: null,
      }),
    )
  }
}
