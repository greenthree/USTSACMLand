import {
  type AlertDeliveryOptions,
  type AlertDeliveryResult,
  deliverOperationalAlertPayload,
} from './alerts.ts'

export type RuntimeErrorSurface =
  'sync-member' | 'sync-stats' | 'delete-account' | 'change-password'

export type RuntimeErrorCategory =
  'abort' | 'type_error' | 'unexpected_error' | 'non_error_throwable'

export interface RuntimeErrorAlert {
  surface: RuntimeErrorSurface
  category: RuntimeErrorCategory
  occurredAt: string
  requestId: string | null
}

function requestIdFromHeaders(headers: Headers): string | null {
  for (const name of ['x-request-id', 'sb-request-id']) {
    const value = headers.get(name)?.trim()
    if (value && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) return value
  }
  return null
}

export function classifyRuntimeError(error: unknown): RuntimeErrorCategory {
  if (error instanceof DOMException && error.name === 'AbortError') return 'abort'
  if (error instanceof TypeError) return 'type_error'
  if (error instanceof Error) return 'unexpected_error'
  return 'non_error_throwable'
}

export function runtimeErrorAlert(
  surface: RuntimeErrorSurface,
  request: Request,
  error: unknown,
  now = () => new Date(),
): RuntimeErrorAlert {
  return {
    surface,
    category: classifyRuntimeError(error),
    occurredAt: now().toISOString(),
    requestId: requestIdFromHeaders(request.headers),
  }
}

export function deliverRuntimeErrorAlert(
  alert: RuntimeErrorAlert,
  options: AlertDeliveryOptions = {},
): Promise<AlertDeliveryResult> {
  return deliverOperationalAlertPayload(
    {
      version: 1,
      event: 'runtime_error',
      ...alert,
    },
    { timeoutMs: 1_500, ...options },
  )
}

export async function notifyRuntimeError(alert: RuntimeErrorAlert): Promise<void> {
  try {
    const result = await deliverRuntimeErrorAlert(alert)
    if (result.configured && !result.delivered) {
      console.warn(
        JSON.stringify({
          event: 'runtime_error_alert_delivery_failed',
          surface: alert.surface,
          status: result.status,
        }),
      )
    }
  } catch {
    console.warn(
      JSON.stringify({
        event: 'runtime_error_alert_delivery_failed',
        surface: alert.surface,
        status: null,
      }),
    )
  }
}
