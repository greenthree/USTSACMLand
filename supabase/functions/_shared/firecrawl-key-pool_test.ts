import type { SupabaseClient } from '@supabase/supabase-js'
import { deepStrictEqual, equal } from 'node:assert/strict'
import {
  firecrawlKeyFailureCode,
  listFirecrawlRuntimeKeys,
  observeFirecrawlOperation,
  recordFirecrawlObservation,
  selectFirecrawlRuntimeKey,
} from './firecrawl-key-pool.ts'
import { HttpError } from './http.ts'

function client(
  responder: (name: string, args: Record<string, unknown> | undefined) => unknown,
): SupabaseClient {
  return {
    rpc(name: string, args?: Record<string, unknown>) {
      return Promise.resolve({ data: responder(name, args), error: null })
    },
  } as unknown as SupabaseClient
}

Deno.test('Firecrawl key pool selects exactly one redacted database key', async () => {
  const calls: Array<{ name: string; args: unknown }> = []
  const selected = await selectFirecrawlRuntimeKey(
    client((name, args) => {
      calls.push({ name, args })
      return [
        {
          pool_configured: true,
          key_id: '00000000-0000-4000-8000-000000000301',
          api_key: 'fc-runtime-secret',
        },
      ]
    }),
    'qoj',
    'qoj:42:1:00000000-0000-4000-8000-000000000301',
  )
  deepStrictEqual(calls, [
    {
      name: 'select_firecrawl_runtime_key',
      args: {
        requested_purpose: 'qoj',
        requested_operation_id: 'qoj:42:1:00000000-0000-4000-8000-000000000301',
      },
    },
  ])
  equal(selected?.keyId, '00000000-0000-4000-8000-000000000301')
  equal(selected?.apiKey, 'fc-runtime-secret')
  equal(selected?.source, 'database')
})

Deno.test(
  'configured but unavailable Firecrawl pools do not use an environment fallback',
  async () => {
    const selected = await selectFirecrawlRuntimeKey(
      client(() => [{ pool_configured: true, key_id: null, api_key: null }]),
      'qoj',
      'qoj:43:1:00000000-0000-4000-8000-000000000301',
    )
    deepStrictEqual(selected, null)
    deepStrictEqual(
      await listFirecrawlRuntimeKeys(
        client(() => [{ pool_configured: true, key_id: null, api_key: null }]),
      ),
      [],
    )
  },
)

Deno.test('Firecrawl observations send only structured fields to the database', async () => {
  let received: unknown
  const key = {
    keyId: '00000000-0000-4000-8000-000000000301',
    apiKey: 'fc-secret-must-not-be-recorded',
    apiUrl: 'https://api.firecrawl.dev',
    source: 'database' as const,
  }
  await recordFirecrawlObservation(
    client((_name, args) => {
      received = args
      return null
    }),
    key,
    'credit_monitor',
    true,
    null,
    {
      remainingCredits: 409,
      planCredits: 1000,
      billingPeriodEnd: null,
      severity: null,
    },
  )
  deepStrictEqual(received, {
    target_key_id: key.keyId,
    requested_purpose: 'credit_monitor',
    observed_success: true,
    observed_error_code: null,
    observed_credits_remaining: 409,
    observed_credits_total: 1000,
    observed_billing_period_end: null,
    observed_severity: null,
  })
  equal(JSON.stringify(received).includes(key.apiKey), false)
})

Deno.test('parsed QOJ failures do not falsely quarantine a working Firecrawl key', async () => {
  const observations: unknown[] = []
  const key = {
    keyId: '00000000-0000-4000-8000-000000000301',
    apiKey: 'fc-runtime-secret',
    apiUrl: 'https://api.firecrawl.dev',
    source: 'database' as const,
  }
  const error = new HttpError(
    'QOJ credentials rejected',
    'auth_expired',
    false,
    undefined,
    undefined,
    {
      authTarget: 'qoj',
    },
  )
  const fake = client((_name, args) => {
    observations.push(args)
    return null
  })
  await observeFirecrawlOperation(fake, key, 'qoj', () => Promise.reject(error)).catch(
    () => undefined,
  )
  equal(firecrawlKeyFailureCode(error), null)
  equal((observations[0] as Record<string, unknown>).observed_success, true)
  equal((observations[0] as Record<string, unknown>).observed_error_code, null)
})

Deno.test('Firecrawl transport authentication and rate limits are classified per key', () => {
  equal(
    firecrawlKeyFailureCode(
      new HttpError('invalid key', 'auth_expired', false, 401, undefined, {
        authTarget: 'firecrawl',
      }),
    ),
    'auth_expired',
  )
  equal(
    firecrawlKeyFailureCode(new HttpError('limited', 'rate_limited', true, 429)),
    'rate_limited',
  )
  equal(firecrawlKeyFailureCode(new HttpError('page changed', 'schema_changed', false)), null)
})
