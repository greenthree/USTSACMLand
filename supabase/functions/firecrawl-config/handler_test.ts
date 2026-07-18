// deno-lint-ignore-file require-await
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import {
  createFirecrawlConfigHandler,
  type FirecrawlConfigHandlerDependencies,
  type FirecrawlConfigServices,
  FirecrawlConfigServiceError,
} from './handler.ts'

const allowedOrigin = 'https://greenthree.github.io'
const userId = '00000000-0000-4000-8000-000000000331'
const key = {
  id: '00000000-0000-4000-8000-000000000301',
  label: 'Primary',
  keyConfigured: true,
  enabled: false,
  priority: 100,
  healthStatus: 'healthy' as const,
  consecutiveFailures: 0,
  cooldownUntil: null,
  lastSelectedAt: null,
  lastCheckedAt: '2026-07-19T08:00:00.000Z',
  lastSuccessAt: '2026-07-19T08:00:00.000Z',
  lastFailureAt: null,
  lastErrorCode: null,
  creditsRemaining: 409,
  creditsTotal: 1000,
  billingPeriodEnd: '2026-07-24T12:37:07.733Z',
  version: 2,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-19T08:00:00.000Z',
}

function services(overrides: Partial<FirecrawlConfigServices> = {}): FirecrawlConfigServices {
  return {
    async getUser() {
      return { id: userId }
    },
    async getAdminState() {
      return { role: 'admin', reviewStatus: 'approved' }
    },
    async listKeys() {
      return [key]
    },
    async upsertKey() {
      return { ...key, version: 3 }
    },
    async deleteKey(_userId, keyId) {
      return keyId
    },
    async checkKey() {
      return { key, succeeded: true, errorCode: null }
    },
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<FirecrawlConfigHandlerDependencies> = {},
): FirecrawlConfigHandlerDependencies {
  return {
    allowedOrigins: allowedOrigin,
    createServices: () => services(),
    async reportUnexpectedError() {},
    ...overrides,
  }
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/firecrawl-config', {
    method: 'POST',
    headers: {
      authorization: 'Bearer administrator-token',
      origin: allowedOrigin,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

Deno.test('Firecrawl config requires an explicit CORS allowlist', async () => {
  for (const allowedOrigins of ['', '*']) {
    await rejects(
      async () => createFirecrawlConfigHandler(dependencies({ allowedOrigins })),
      /explicit CORS origin allowlist/,
    )
  }
})

Deno.test('Firecrawl config requires a live approved administrator', async () => {
  const missing = await createFirecrawlConfigHandler(dependencies())(
    request({ action: 'read' }, { authorization: '' }),
  )
  strictEqual(missing.status, 401)

  for (const adminState of [
    { role: 'member', reviewStatus: 'approved' },
    { role: 'admin', reviewStatus: 'suspended' },
    null,
  ]) {
    let reads = 0
    const response = await createFirecrawlConfigHandler(
      dependencies({
        createServices: () =>
          services({
            async getAdminState() {
              return adminState
            },
            async listKeys() {
              reads += 1
              return [key]
            },
          }),
      }),
    )(request({ action: 'read' }))
    strictEqual(response.status, 403)
    strictEqual(reads, 0)
  }
})

Deno.test('Firecrawl config read returns redacted no-store metadata', async () => {
  const response = await createFirecrawlConfigHandler(dependencies())(
    request({ action: 'read' }, { 'x-request-id': 'firecrawl-read-1' }),
  )
  strictEqual(response.status, 200)
  strictEqual(response.headers.get('cache-control'), 'private, no-store')
  strictEqual(response.headers.get('x-request-id'), 'firecrawl-read-1')
  const body = await json(response)
  deepStrictEqual(body, { keys: [key] })
  strictEqual(JSON.stringify(body).includes('secret'), false)
})

Deno.test('Firecrawl config upsert forwards a replacement once and never echoes it', async () => {
  let received: unknown
  const response = await createFirecrawlConfigHandler(
    dependencies({
      createServices: () =>
        services({
          async upsertKey(_userId, update) {
            received = update
            return { ...key, version: 3 }
          },
        }),
    }),
  )(
    request({
      action: 'upsert',
      keyId: key.id,
      label: 'Primary rotated',
      apiKey: 'fc-secret-must-never-echo',
      enabled: false,
      priority: 90,
      expectedVersion: 2,
      reason: 'rotate production key',
    }),
  )

  strictEqual(response.status, 200)
  deepStrictEqual(received, {
    keyId: key.id,
    label: 'Primary rotated',
    apiKey: 'fc-secret-must-never-echo',
    enabled: false,
    priority: 90,
    expectedVersion: 2,
    reason: 'rotate production key',
  })
  strictEqual(JSON.stringify(await json(response)).includes('fc-secret-must-never-echo'), false)
})

Deno.test('Firecrawl config supports one-shot checks and optimistic deletes', async () => {
  let deleted: unknown
  const handler = createFirecrawlConfigHandler(
    dependencies({
      createServices: () =>
        services({
          async deleteKey(targetUserId, keyId, expectedVersion, reason) {
            deleted = { targetUserId, keyId, expectedVersion, reason }
            return keyId
          },
        }),
    }),
  )
  const checked = await handler(request({ action: 'check', keyId: key.id }))
  deepStrictEqual(await json(checked), {
    check: { key, succeeded: true, errorCode: null },
  })
  const removed = await handler(
    request({ action: 'delete', keyId: key.id, expectedVersion: 2, reason: 'retire key' }),
  )
  strictEqual(removed.status, 200)
  deepStrictEqual(deleted, {
    targetUserId: userId,
    keyId: key.id,
    expectedVersion: 2,
    reason: 'retire key',
  })
})

Deno.test('Firecrawl config rejects ambiguous fields and maps service failures', async () => {
  const unknown = await createFirecrawlConfigHandler(dependencies())(
    request({ action: 'read', apiKey: 'must-not-be-accepted' }),
  )
  strictEqual(unknown.status, 400)

  for (const [serviceError, status, code] of [
    [new FirecrawlConfigServiceError('conflict'), 409, 'config_conflict'],
    [new FirecrawlConfigServiceError('rate_limited', 12), 429, 'admin_rate_limited'],
    [new FirecrawlConfigServiceError('invalid_request'), 400, 'invalid_request'],
    [new FirecrawlConfigServiceError('not_found'), 404, 'key_not_found'],
  ] as const) {
    const response = await createFirecrawlConfigHandler(
      dependencies({
        createServices: () =>
          services({
            async checkKey() {
              throw serviceError
            },
          }),
      }),
    )(request({ action: 'check', keyId: key.id }))
    strictEqual(response.status, status)
    strictEqual(((await json(response)).error as { code: string }).code, code)
  }
})
