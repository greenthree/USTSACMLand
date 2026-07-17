// deno-lint-ignore-file require-await
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import {
  createWebChatConfigHandler,
  type WebChatConfigHandlerDependencies,
  type WebChatConfigServices,
  WebChatConfigServiceError,
} from './handler.ts'

const allowedOrigin = 'https://greenthree.github.io'
const userId = '11111111-1111-4111-8111-111111111111'
const redactedConfig = {
  baseUrl: 'https://relay.example.test/v1',
  model: 'gpt-5.6',
  apiKeyConfigured: true,
  requestsEnabled: false,
  globalDailyRequestLimit: 300,
  globalDailyTokenLimit: 1_000_000,
  version: 4,
  updatedAt: '2026-07-17T08:00:00.000Z',
}
const dailyUsage = {
  usageDate: '2026-07-17',
  requestCount: 28,
  settledTokens: 940_000,
  reservedTokens: 40_000,
  resetAt: '2026-07-17T16:00:00.000Z',
  requestBudgetAlertedAt: null,
  tokenBudgetAlertedAt: '2026-07-17T10:00:00.000Z',
}

function services(overrides: Partial<WebChatConfigServices> = {}): WebChatConfigServices {
  return {
    async getUser() {
      return { id: userId }
    },
    async getAdminState() {
      return { role: 'admin', reviewStatus: 'approved' }
    },
    async readConfig() {
      return redactedConfig
    },
    async readBudgetUsage() {
      return dailyUsage
    },
    async updateConfig() {
      return { ...redactedConfig, version: redactedConfig.version + 1 }
    },
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<WebChatConfigHandlerDependencies> = {},
): WebChatConfigHandlerDependencies {
  return {
    allowedOrigins: allowedOrigin,
    createServices: () => services(),
    async reportUnexpectedError() {},
    ...overrides,
  }
}

function request(
  body: unknown = { action: 'read' },
  headers: Record<string, string> = {},
): Request {
  return new Request('https://project.supabase.co/functions/v1/webchat-config', {
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

Deno.test('webchat config requires an explicit CORS allowlist', async () => {
  for (const allowedOrigins of ['', '*']) {
    await rejects(
      async () => createWebChatConfigHandler(dependencies({ allowedOrigins })),
      /explicit CORS origin allowlist/,
    )
  }
})

Deno.test('webchat config preflight allows only the configured site origin', async () => {
  const handler = createWebChatConfigHandler(dependencies())
  const allowed = await handler(
    new Request('https://project.supabase.co/functions/v1/webchat-config', {
      method: 'OPTIONS',
      headers: { origin: allowedOrigin },
    }),
  )
  strictEqual(allowed.status, 200)
  strictEqual(allowed.headers.get('access-control-allow-origin'), allowedOrigin)
  strictEqual(allowed.headers.get('access-control-allow-methods'), 'POST, OPTIONS')

  const hostile = await handler(request({ action: 'read' }, { origin: 'https://attacker.test' }))
  strictEqual(hostile.status, 403)
  strictEqual(hostile.headers.get('access-control-allow-origin'), null)
})

Deno.test('webchat config rejects unsupported methods before creating services', async () => {
  let serviceCreations = 0
  const response = await createWebChatConfigHandler(
    dependencies({
      createServices() {
        serviceCreations += 1
        return services()
      },
    }),
  )(
    new Request('https://project.supabase.co/functions/v1/webchat-config', {
      method: 'GET',
      headers: { origin: allowedOrigin },
    }),
  )

  strictEqual(response.status, 405)
  strictEqual(serviceCreations, 0)
})

Deno.test('webchat config requires a live authenticated approved administrator', async () => {
  const missing = await createWebChatConfigHandler(dependencies())(
    request({ action: 'read' }, { authorization: '' }),
  )
  strictEqual(missing.status, 401)

  const expired = await createWebChatConfigHandler(
    dependencies({
      createServices: () =>
        services({
          async getUser() {
            return null
          },
        }),
    }),
  )(request())
  strictEqual(expired.status, 401)

  for (const adminState of [
    { role: 'member', reviewStatus: 'approved' },
    { role: 'admin', reviewStatus: 'suspended' },
    null,
  ]) {
    let reads = 0
    const response = await createWebChatConfigHandler(
      dependencies({
        createServices: () =>
          services({
            async getAdminState(targetUserId) {
              strictEqual(targetUserId, userId)
              return adminState
            },
            async readConfig() {
              reads += 1
              return redactedConfig
            },
          }),
      }),
    )(request())
    strictEqual(response.status, 403)
    strictEqual(reads, 0)
  }
})

Deno.test(
  'webchat config read action returns only redacted metadata with no-store headers',
  async () => {
    const response = await createWebChatConfigHandler(dependencies())(
      request({ action: 'read' }, { 'x-request-id': 'config-read-1' }),
    )
    strictEqual(response.status, 200)
    strictEqual(response.headers.get('cache-control'), 'private, no-store')
    strictEqual(response.headers.get('x-request-id'), 'config-read-1')
    deepStrictEqual(await json(response), {
      config: { ...redactedConfig, dailyUsage },
    })
    strictEqual(JSON.stringify(redactedConfig).includes('must-never'), false)
  },
)

Deno.test('webchat config update action forwards the key once and never returns it', async () => {
  let received: unknown
  const response = await createWebChatConfigHandler(
    dependencies({
      createServices: () =>
        services({
          async updateConfig(targetUserId, update) {
            strictEqual(targetUserId, userId)
            received = update
            return { ...redactedConfig, version: 5 }
          },
        }),
    }),
  )(
    request({
      action: 'update',
      baseUrl: 'https://relay.example.test/v1',
      model: 'gpt-5.6',
      apiKey: 'secret-key-that-must-not-echo',
      requestsEnabled: true,
      globalDailyRequestLimit: 400,
      globalDailyTokenLimit: 1_200_000,
      expectedVersion: 4,
      reason: 'rotate production relay',
    }),
  )

  strictEqual(response.status, 200)
  deepStrictEqual(received, {
    baseUrl: 'https://relay.example.test/v1',
    model: 'gpt-5.6',
    apiKey: 'secret-key-that-must-not-echo',
    requestsEnabled: true,
    globalDailyRequestLimit: 400,
    globalDailyTokenLimit: 1_200_000,
    expectedVersion: 4,
    reason: 'rotate production relay',
  })
  const serialized = JSON.stringify(await json(response))
  strictEqual(serialized.includes('secret-key-that-must-not-echo'), false)
  strictEqual(serialized.includes('"apiKey"'), false)
  strictEqual(serialized.includes('"apiKeyConfigured":true'), true)
})

Deno.test('webchat config rejects oversized, malformed, and ambiguous update bodies', async () => {
  const handler = createWebChatConfigHandler(dependencies({ maxBodyBytes: 128 }))
  const oversized = await handler(
    request({
      action: 'update',
      baseUrl: `https://${'a'.repeat(200)}.example.test/v1`,
      model: 'gpt-5.6',
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 0,
      reason: 'test',
    }),
  )
  strictEqual(oversized.status, 413)

  const malformed = await handler(
    new Request('https://project.supabase.co/functions/v1/webchat-config', {
      method: 'POST',
      headers: { authorization: 'Bearer token', origin: allowedOrigin },
      body: '{',
    }),
  )
  strictEqual(malformed.status, 400)

  const unknown = await createWebChatConfigHandler(dependencies())(
    request({
      action: 'update',
      baseUrl: 'https://relay.example.test/v1',
      model: 'gpt-5.6',
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 0,
      reason: 'test',
      api_key: 'ambiguous-secret-field',
    }),
  )
  strictEqual(unknown.status, 400)

  const ambiguousRead = await createWebChatConfigHandler(dependencies())(
    request({ action: 'read', apiKey: 'must-not-be-accepted' }),
  )
  strictEqual(ambiguousRead.status, 400)
})

Deno.test(
  'webchat config maps RPC conflict, rate limit, validation, and recheck failures',
  async () => {
    for (const [serviceError, status, code, retryAfter] of [
      [new WebChatConfigServiceError('conflict'), 409, 'config_conflict', null],
      [new WebChatConfigServiceError('rate_limited', 19), 429, 'admin_rate_limited', '19'],
      [new WebChatConfigServiceError('invalid_request'), 400, 'invalid_request', null],
      [new WebChatConfigServiceError('forbidden'), 403, 'admin_required', null],
    ] as const) {
      const response = await createWebChatConfigHandler(
        dependencies({
          createServices: () =>
            services({
              async updateConfig() {
                throw serviceError
              },
            }),
        }),
      )(
        request({
          action: 'update',
          baseUrl: 'https://relay.example.test/v1',
          model: 'gpt-5.6',
          requestsEnabled: false,
          globalDailyRequestLimit: 300,
          globalDailyTokenLimit: 1_000_000,
          expectedVersion: 4,
          reason: 'change relay',
        }),
      )
      strictEqual(response.status, status)
      strictEqual(((await json(response)).error as { code: string }).code, code)
      strictEqual(response.headers.get('retry-after'), retryAfter)
    }
  },
)

Deno.test('webchat config redacts unexpected database failures and reports them', async () => {
  const errors: unknown[] = []
  const response = await createWebChatConfigHandler(
    dependencies({
      createServices: () =>
        services({
          async readConfig() {
            throw new Error('vault secret value leaked here')
          },
        }),
      async reportUnexpectedError(_request, error) {
        errors.push(error)
      },
    }),
  )(request())

  strictEqual(response.status, 500)
  strictEqual(JSON.stringify(await json(response)).includes('vault secret'), false)
  strictEqual(errors.length, 1)
})

Deno.test('webchat config reads usage before applying a configuration mutation', async () => {
  let updates = 0
  const response = await createWebChatConfigHandler(
    dependencies({
      createServices: () =>
        services({
          async readBudgetUsage() {
            throw new Error('budget usage unavailable')
          },
          async updateConfig() {
            updates += 1
            return redactedConfig
          },
        }),
    }),
  )(
    request({
      action: 'update',
      baseUrl: 'https://relay.example.test/v1',
      model: 'gpt-5.6',
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 4,
      reason: 'verify mutation ordering',
    }),
  )

  strictEqual(response.status, 500)
  strictEqual(updates, 0)
})
