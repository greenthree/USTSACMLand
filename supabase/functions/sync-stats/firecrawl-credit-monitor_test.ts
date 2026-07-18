import type { SupabaseClient } from '@supabase/supabase-js'
import { deepStrictEqual, equal } from 'node:assert/strict'
import { monitorFirecrawlCredits } from './firecrawl-credit-monitor.ts'

Deno.test('Firecrawl credit monitor checks every key once and isolates failures', async () => {
  const observations: Record<string, unknown>[] = []
  const client = {
    rpc(name: string, args?: Record<string, unknown>) {
      if (name === 'list_firecrawl_runtime_keys') {
        return Promise.resolve({
          data: [
            {
              pool_configured: true,
              key_id: '00000000-0000-4000-8000-000000000301',
              api_key: 'fc-first-secret',
            },
            {
              pool_configured: true,
              key_id: '00000000-0000-4000-8000-000000000302',
              api_key: 'fc-second-secret',
            },
          ],
          error: null,
        })
      }
      observations.push(args ?? {})
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as SupabaseClient
  const checkedKeys: string[] = []
  const alerts: unknown[] = []

  const summary = await monitorFirecrawlCredits(client, {
    readUsage(options) {
      checkedKeys.push(options?.apiKey ?? '')
      if (options?.apiKey === 'fc-second-secret') {
        return Promise.reject(new Error('Firecrawl credit usage returned HTTP 401'))
      }
      return Promise.resolve({
        configured: true,
        remainingCredits: 90,
        planCredits: 1000,
        percentRemaining: 9,
        billingPeriodEnd: null,
        severity: 'critical',
      })
    },
    notify(alert) {
      alerts.push(alert)
      return Promise.resolve()
    },
  })

  deepStrictEqual(checkedKeys.sort(), ['fc-first-secret', 'fc-second-secret'])
  deepStrictEqual(summary, {
    configuredKeys: 2,
    checkedKeys: 2,
    failedKeys: 1,
    alertedKeys: 1,
  })
  equal(alerts.length, 1)
  equal((alerts[0] as { keyId: string }).keyId, '00000000-0000-4000-8000-000000000301')
  equal(observations.length, 2)
  equal(
    observations.some((row) => row.observed_error_code === 'auth_expired'),
    true,
  )
  equal(JSON.stringify(alerts).includes('fc-first-secret'), false)
  equal(JSON.stringify(observations).includes('fc-second-secret'), false)
})

Deno.test('Firecrawl credit monitor bounds pool concurrency to two requests', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    pool_configured: true,
    key_id: `00000000-0000-4000-8000-00000000030${index}`,
    api_key: `fc-secret-${index}`,
  }))
  const client = {
    rpc(name: string) {
      return Promise.resolve({
        data: name === 'list_firecrawl_runtime_keys' ? rows : null,
        error: null,
      })
    },
  } as unknown as SupabaseClient
  let active = 0
  let maximumActive = 0

  const summary = await monitorFirecrawlCredits(client, {
    maxConcurrency: 2,
    async readUsage() {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return {
        configured: true,
        remainingCredits: 900,
        planCredits: 1000,
        percentRemaining: 90,
        billingPeriodEnd: null,
        severity: null,
      }
    },
  })

  equal(summary.checkedKeys, 5)
  equal(summary.failedKeys, 0)
  equal(maximumActive, 2)
})
