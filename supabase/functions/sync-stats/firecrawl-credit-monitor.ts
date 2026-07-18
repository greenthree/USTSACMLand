import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyFirecrawlCreditAlert } from '../_shared/alerts.ts'
import {
  listFirecrawlRuntimeKeys,
  recordFirecrawlObservation,
  type FirecrawlRuntimeKey,
} from '../_shared/firecrawl-key-pool.ts'
import { readFirecrawlCreditUsage, type FirecrawlCreditUsage } from '../_shared/firecrawl-usage.ts'

export interface FirecrawlCreditMonitorSummary {
  configuredKeys: number
  checkedKeys: number
  failedKeys: number
  alertedKeys: number
}

export interface FirecrawlCreditMonitorDependencies {
  readUsage?: typeof readFirecrawlCreditUsage
  notify?: typeof notifyFirecrawlCreditAlert
  maxConcurrency?: number
}

export function creditFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/HTTP 401\b/.test(message)) return 'auth_expired'
  if (/HTTP 403\b/.test(message)) return 'auth_required'
  if (/HTTP 429\b/.test(message)) return 'rate_limited'
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  if (error instanceof TypeError) return 'network_error'
  return 'source_unavailable'
}

async function monitorOneKey(
  client: SupabaseClient,
  key: FirecrawlRuntimeKey,
  dependencies: Required<FirecrawlCreditMonitorDependencies>,
): Promise<{ failed: boolean; alerted: boolean }> {
  let usage: FirecrawlCreditUsage
  try {
    usage = await dependencies.readUsage({ apiKey: key.apiKey, apiUrl: key.apiUrl })
    if (
      !usage.configured ||
      usage.remainingCredits === null ||
      usage.planCredits === null ||
      usage.percentRemaining === null
    ) {
      throw new Error('Firecrawl credit usage returned incomplete data')
    }
  } catch (error) {
    await recordFirecrawlObservation(
      client,
      key,
      'credit_monitor',
      false,
      creditFailureCode(error),
    ).catch(() => undefined)
    console.warn(JSON.stringify({ event: 'firecrawl_credit_check_failed' }))
    return { failed: true, alerted: false }
  }

  await recordFirecrawlObservation(client, key, 'credit_monitor', true, null, {
    remainingCredits: usage.remainingCredits,
    planCredits: usage.planCredits,
    billingPeriodEnd: usage.billingPeriodEnd,
    severity: usage.severity,
  }).catch(() => {
    console.warn(
      JSON.stringify({ event: 'firecrawl_key_observation_failed', purpose: 'credit_monitor' }),
    )
  })

  if (!usage.severity) return { failed: false, alerted: false }
  await dependencies.notify({
    keyId: key.keyId ?? 'environment',
    checkedAt: new Date().toISOString(),
    remainingCredits: usage.remainingCredits,
    planCredits: usage.planCredits,
    percentRemaining: Number(usage.percentRemaining.toFixed(2)),
    billingPeriodEnd: usage.billingPeriodEnd,
    severity: usage.severity,
  })
  return { failed: false, alerted: true }
}

export async function monitorFirecrawlCredits(
  client: SupabaseClient,
  dependencies: FirecrawlCreditMonitorDependencies = {},
): Promise<FirecrawlCreditMonitorSummary> {
  const keys = await listFirecrawlRuntimeKeys(client)
  const resolvedDependencies: Required<FirecrawlCreditMonitorDependencies> = {
    readUsage: dependencies.readUsage ?? readFirecrawlCreditUsage,
    notify: dependencies.notify ?? notifyFirecrawlCreditAlert,
    maxConcurrency: Math.max(1, Math.min(2, dependencies.maxConcurrency ?? 2)),
  }
  const results: Array<{ failed: boolean; alerted: boolean }> = new Array(keys.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < keys.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await monitorOneKey(client, keys[index], resolvedDependencies)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(keys.length, resolvedDependencies.maxConcurrency) }, () =>
      worker(),
    ),
  )
  return {
    configuredKeys: keys.length,
    checkedKeys: results.length,
    failedKeys: results.filter((result) => result.failed).length,
    alertedKeys: results.filter((result) => result.alerted).length,
  }
}
