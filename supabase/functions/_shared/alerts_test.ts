import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import {
  deliverFirecrawlCreditAlert,
  deliverSyncFailureAlert,
  shouldNotifySyncFailure,
  type SyncFailureAlert,
} from './alerts.ts'

const alert: SyncFailureAlert = {
  jobId: 42,
  triggerType: 'scheduled',
  attempt: 3,
  maxAttempts: 3,
  failedAt: '2026-07-15T00:00:00.000Z',
  failures: [{ platform: 'codeforces', code: 'timeout' }],
}

Deno.test('sync failure alerts are a no-op when no webhook is configured', async () => {
  deepStrictEqual(await deliverSyncFailureAlert(alert, { webhookUrl: '' }), {
    configured: false,
    delivered: false,
    status: null,
  })
})

Deno.test('sync failure alerts send only redacted operational fields', async () => {
  let authorization: string | null = null
  let requestBody = ''
  const result = await deliverSyncFailureAlert(alert, {
    webhookUrl: 'https://alerts.example.test/sync',
    webhookToken: 'test-token',
    fetcher: (input, init) => {
      const request = new Request(input, init)
      authorization = request.headers.get('authorization')
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return Promise.resolve(new Response(null, { status: 204 }))
    },
  })

  deepStrictEqual(result, { configured: true, delivered: true, status: 204 })
  strictEqual(authorization, 'Bearer test-token')
  const payload = JSON.parse(requestBody)
  deepStrictEqual(payload, {
    version: 1,
    event: 'sync_job_failed',
    ...alert,
  })
  strictEqual('memberId' in payload, false)
  strictEqual('externalId' in payload, false)
  strictEqual('message' in payload.failures[0], false)
})

Deno.test('sync failure alerts reject insecure or credential-bearing URLs', async () => {
  await rejects(
    () =>
      deliverSyncFailureAlert(alert, {
        webhookUrl: 'http://alerts.example.test/sync',
      }),
    /must be an HTTPS URL/,
  )
  await rejects(
    () =>
      deliverSyncFailureAlert(alert, {
        webhookUrl: 'https://user:pass@example.test/sync',
      }),
    /must be an HTTPS URL/,
  )
})

Deno.test(
  'sync failure alert delivery reports non-success responses without retrying',
  async () => {
    let calls = 0
    const result = await deliverSyncFailureAlert(alert, {
      webhookUrl: 'https://alerts.example.test/sync',
      webhookToken: '',
      fetcher: () => {
        calls += 1
        return Promise.resolve(new Response(null, { status: 503 }))
      },
    })

    strictEqual(calls, 1)
    deepStrictEqual(result, {
      configured: true,
      delivered: false,
      status: 503,
    })
  },
)

Deno.test('sync alerts ignore member identity errors but keep operational failures', () => {
  strictEqual(shouldNotifySyncFailure('not_found'), false)
  strictEqual(shouldNotifySyncFailure('invalid_account'), false)
  strictEqual(shouldNotifySyncFailure('auth_expired'), true)
  strictEqual(shouldNotifySyncFailure('schema_changed'), true)
  strictEqual(shouldNotifySyncFailure('timeout'), true)
})

Deno.test('sync failure alert delivery is bounded by its timeout', async () => {
  await rejects(
    () =>
      deliverSyncFailureAlert(alert, {
        webhookUrl: 'https://alerts.example.test/sync',
        webhookToken: '',
        timeoutMs: 1,
        fetcher: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            )
          }),
      }),
    /aborted/,
  )
})

Deno.test('Firecrawl credit alerts contain only aggregate quota fields', async () => {
  let requestBody = ''
  const result = await deliverFirecrawlCreditAlert(
    {
      checkedAt: '2026-07-15T16:00:00.000Z',
      remainingCredits: 90,
      planCredits: 1000,
      percentRemaining: 9,
      billingPeriodEnd: '2026-07-24T12:37:07.733Z',
      severity: 'critical',
    },
    {
      webhookUrl: 'https://alerts.example.test/sync',
      webhookToken: 'test-token',
      fetcher: (_input, init) => {
        requestBody = typeof init?.body === 'string' ? init.body : ''
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    },
  )

  deepStrictEqual(result, { configured: true, delivered: true, status: 204 })
  deepStrictEqual(JSON.parse(requestBody), {
    version: 1,
    event: 'firecrawl_credit_low',
    checkedAt: '2026-07-15T16:00:00.000Z',
    remainingCredits: 90,
    planCredits: 1000,
    percentRemaining: 9,
    billingPeriodEnd: '2026-07-24T12:37:07.733Z',
    severity: 'critical',
  })
  strictEqual(requestBody.includes('apiKey'), false)
  strictEqual(requestBody.includes('member'), false)
})
