// deno-lint-ignore-file require-await
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import {
  createWebChatHandler,
  type WebChatHandlerDependencies,
  type WebChatServices,
} from './handler.ts'
import { prepareWebChatQuota, type WebChatQuotaPolicy } from './quota.ts'
import type { WebChatRelayRuntimeConfig } from './runtime-config.ts'
import type { WebChatMemberRuntimeAccess } from './member-access.ts'
import { type StartWebChatOptions, WebChatUpstreamError } from './upstream.ts'

const userId = '11111111-1111-4111-8111-111111111111'
const allowedOrigin = 'https://greenthree.github.io'
const quotaPolicy: WebChatQuotaPolicy = {
  model: 'gpt-5.6',
  systemPrompt: 'Server prompt',
  promptVersion: 'prompt-v1',
  maxOutputTokens: 2_048,
  minuteRequestLimit: 3,
  memberTotalRequestLimit: 30,
  memberTotalTokenLimit: 100_000,
  leaseSeconds: 180,
}
const runtimeConfig: WebChatRelayRuntimeConfig = {
  baseUrl: 'https://relay.example.test/v1',
  apiKey: 'server-secret',
  model: quotaPolicy.model,
  requestsEnabled: true,
  globalDailyRequestLimit: 300,
  globalDailyTokenLimit: 1_000_000,
}
const memberAccess: WebChatMemberRuntimeAccess = {
  accountEligible: true,
  enabled: true,
  totalRequestLimit: 30,
  totalTokenLimit: 100_000,
  version: 1,
}

function request(
  body: unknown = {
    id: 'chat-1',
    trigger: 'submit-message',
    messageId: 'user-1',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: '解释二分' }],
      },
    ],
  },
  headers: Record<string, string> = {},
): Request {
  return new Request('https://project.supabase.co/functions/v1/webchat', {
    method: 'POST',
    headers: {
      authorization: 'Bearer member-token',
      'content-type': 'application/json',
      origin: allowedOrigin,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function services(overrides: Partial<WebChatServices> = {}): WebChatServices {
  return {
    async getUser() {
      return { id: userId }
    },
    async readMemberRuntimeAccess() {
      return memberAccess
    },
    async readRelayRuntimeConfig() {
      return runtimeConfig
    },
    async claimWebChatRequest() {
      return {
        decision: 'acquired',
        status: 'claimed',
        remainingMinuteRequests: 2,
        remainingTotalRequests: 29,
        remainingTotalTokens: 90_000,
        retryAfterSeconds: null,
      }
    },
    async claimWebChatBudgetAlert(input) {
      return {
        shouldNotify: false,
        budgetKind: input.budgetKind,
        usageDate: '2026-07-17',
        budgetLimit: input.budgetLimit,
        requestCount: 0,
        settledTokens: 0,
        reservedTokens: 0,
        attemptedReservedTokens: input.attemptedReservedTokens,
        observedUsage: input.attemptedReservedTokens,
        observedAt: '2026-07-17T10:00:00.000Z',
        resetAt: '2026-07-17T16:00:00.000Z',
      }
    },
    async notifyWebChatBudgetAlert() {},
    async markWebChatRequestStarted() {
      return true
    },
    async finalizeWebChatRequest() {
      return true
    },
    async releaseWebChatRequest() {
      return true
    },
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<WebChatHandlerDependencies> = {},
): WebChatHandlerDependencies {
  return {
    enabled: true,
    allowedOrigins: allowedOrigin,
    quotaPolicy,
    buildSystemPrompt: () => quotaPolicy.systemPrompt,
    createServices: () => services(),
    async startChat() {
      return new Response('data: [DONE]\n\n', {
        headers: {
          'content-type': 'text/event-stream',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      })
    },
    async reportUnexpectedError() {},
    ...overrides,
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

Deno.test('webchat requires an explicit non-wildcard CORS allowlist', async () => {
  for (const allowedOrigins of ['', '*']) {
    await rejects(
      async () => createWebChatHandler(dependencies({ allowedOrigins })),
      /explicit CORS origin allowlist/,
    )
  }
})

Deno.test('webchat rejects hostile origins and unsupported methods before services', async () => {
  let serviceCount = 0
  const handler = createWebChatHandler(
    dependencies({
      createServices() {
        serviceCount += 1
        return services()
      },
    }),
  )

  const hostile = await handler(request(undefined, { origin: 'https://attacker.example' }))
  strictEqual(hostile.status, 403)
  strictEqual(hostile.headers.get('access-control-allow-origin'), null)

  const method = await handler(
    new Request('https://project.supabase.co/functions/v1/webchat', {
      method: 'GET',
      headers: { origin: allowedOrigin },
    }),
  )
  strictEqual(method.status, 405)
  strictEqual(serviceCount, 0)
})

Deno.test('webchat preflight allows the exact site origin and request ID header', async () => {
  const response = await createWebChatHandler(dependencies())(
    new Request('https://project.supabase.co/functions/v1/webchat', {
      method: 'OPTIONS',
      headers: { origin: allowedOrigin },
    }),
  )

  strictEqual(response.status, 200)
  strictEqual(response.headers.get('access-control-allow-origin'), allowedOrigin)
  strictEqual(response.headers.get('vary'), 'Origin')
  strictEqual(response.headers.get('access-control-allow-headers')?.includes('x-request-id'), true)
})

Deno.test(
  'webchat allows authenticated non-browser clients without treating CORS as Auth',
  async () => {
    const response = await createWebChatHandler(dependencies())(request(undefined, { origin: '' }))

    strictEqual(response.status, 200)
    strictEqual(response.headers.get('access-control-allow-origin'), null)
  },
)

Deno.test('webchat disabled switch fails before Auth or request parsing', async () => {
  let serviceCount = 0
  const response = await createWebChatHandler(
    dependencies({
      enabled: false,
      createServices() {
        serviceCount += 1
        return services()
      },
    }),
  )(request({ model: 'client-selected-model' }, { authorization: '' }))

  strictEqual(response.status, 503)
  deepStrictEqual((await responseBody(response)).error, {
    code: 'chat_disabled',
    message: 'AI 学习助手尚未开放',
  })
  strictEqual(serviceCount, 0)
})

Deno.test(
  'webchat authenticates the bearer token and requires an eligible authorized member',
  async () => {
    let approvedChecks = 0
    const missing = await createWebChatHandler(dependencies())(
      request(undefined, { authorization: '' }),
    )
    strictEqual(missing.status, 401)

    const expired = await createWebChatHandler(
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

    const suspended = await createWebChatHandler(
      dependencies({
        createServices: () =>
          services({
            async readMemberRuntimeAccess(targetUserId) {
              strictEqual(targetUserId, userId)
              approvedChecks += 1
              return { ...memberAccess, accountEligible: false, enabled: false }
            },
          }),
      }),
    )(request())
    strictEqual(suspended.status, 403)
    strictEqual(approvedChecks, 1)

    let relayReads = 0
    const notAuthorized = await createWebChatHandler(
      dependencies({
        createServices: () =>
          services({
            async readMemberRuntimeAccess() {
              return { ...memberAccess, enabled: false }
            },
            async readRelayRuntimeConfig() {
              relayReads += 1
              throw new Error('must not decrypt relay configuration')
            },
          }),
      }),
    )(request({ messages: [] }))
    strictEqual(notAuthorized.status, 403)
    deepStrictEqual((await responseBody(notAuthorized)).error, {
      code: 'chat_access_denied',
      message: '当前账号尚未开通 AI 学习助手',
    })
    strictEqual(relayReads, 0)
  },
)

Deno.test('webchat administrator pause rejects before parsing or claiming quota', async () => {
  let claims = 0
  const response = await createWebChatHandler(
    dependencies({
      createServices: () =>
        services({
          async readRelayRuntimeConfig() {
            return { ...runtimeConfig, requestsEnabled: false }
          },
          async claimWebChatRequest() {
            claims += 1
            throw new Error('must not claim while paused')
          },
        }),
    }),
  )(request({ model: 'client-selected-model' }))

  strictEqual(response.status, 503)
  deepStrictEqual((await responseBody(response)).error, {
    code: 'chat_paused',
    message: 'AI 学习助手已由管理员暂停',
  })
  strictEqual(claims, 0)
})

Deno.test('webchat forwards only validated messages and server-derived identity', async () => {
  const starts: StartWebChatOptions[] = []
  const response = await createWebChatHandler(
    dependencies({
      async startChat(options) {
        starts.push(options)
        return new Response('data: [DONE]\n\n', {
          headers: {
            'content-type': 'text/event-stream',
            'x-vercel-ai-ui-message-stream': 'v1',
          },
        })
      },
    }),
  )(request(undefined, { 'x-request-id': 'client-request-1' }))

  strictEqual(response.status, 200)
  strictEqual(response.headers.get('access-control-allow-origin'), allowedOrigin)
  strictEqual(response.headers.get('x-request-id'), 'client-request-1')
  strictEqual(response.headers.get('cache-control'), 'private, no-store, no-transform')
  strictEqual(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1')
  strictEqual(starts.length, 1)
  strictEqual(starts[0].userId, userId)
  strictEqual(starts[0].requestId, 'client-request-1')
  deepStrictEqual(starts[0].messages, [
    {
      id: 'user-1',
      role: 'user',
      text: '解释二分',
    },
  ])
})

Deno.test('webchat resolves the actual relay model before quota fingerprinting', async () => {
  const dynamicRuntime = { ...runtimeConfig, model: 'runtime-model-v2' }
  let claimedFingerprint = ''
  let startedRuntime: WebChatRelayRuntimeConfig | null = null
  let startedSystemPrompt = ''
  const dynamicSystemPrompt = `Server prompt for ${dynamicRuntime.model}`
  const response = await createWebChatHandler(
    dependencies({
      buildSystemPrompt(model) {
        return `Server prompt for ${model}`
      },
      createServices: () =>
        services({
          async readRelayRuntimeConfig() {
            return dynamicRuntime
          },
          async claimWebChatRequest(input) {
            claimedFingerprint = input.fingerprint
            return {
              decision: 'acquired',
              status: 'claimed',
              remainingMinuteRequests: 2,
              remainingTotalRequests: 29,
              remainingTotalTokens: 90_000,
              retryAfterSeconds: null,
            }
          },
        }),
      async startChat(_options, resolvedRuntime, systemPrompt) {
        startedRuntime = resolvedRuntime
        startedSystemPrompt = systemPrompt
        return new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    }),
  )(request(undefined, { 'x-request-id': 'dynamic-model-request' }))

  const staticPolicyFingerprint = await prepareWebChatQuota(
    [{ id: 'user-1', role: 'user', text: '解释二分' }],
    quotaPolicy,
  )
  const dynamicPolicyFingerprint = await prepareWebChatQuota(
    [{ id: 'user-1', role: 'user', text: '解释二分' }],
    {
      ...quotaPolicy,
      model: dynamicRuntime.model,
      systemPrompt: dynamicSystemPrompt,
    },
  )
  strictEqual(response.status, 200)
  strictEqual(claimedFingerprint === staticPolicyFingerprint.fingerprint, false)
  strictEqual(claimedFingerprint, dynamicPolicyFingerprint.fingerprint)
  deepStrictEqual(startedRuntime, dynamicRuntime)
  strictEqual(startedSystemPrompt, dynamicSystemPrompt)
})

Deno.test(
  'webchat claims quota before starting and wires the fenced stream lifecycle',
  async () => {
    const events: string[] = []
    const response = await createWebChatHandler(
      dependencies({
        createServices: () =>
          services({
            async claimWebChatRequest(input) {
              strictEqual(input.userId, userId)
              strictEqual(input.requestId, 'quota-request-1')
              strictEqual(input.ownerToken.length > 20, true)
              strictEqual(input.reservedTokens > quotaPolicy.maxOutputTokens, true)
              strictEqual(input.minuteRequestLimit, quotaPolicy.minuteRequestLimit)
              strictEqual(input.leaseSeconds, quotaPolicy.leaseSeconds)
              events.push('claimed')
              return {
                decision: 'acquired',
                status: 'claimed',
                remainingMinuteRequests: 2,
                remainingTotalRequests: 29,
                remainingTotalTokens: 90_000,
                retryAfterSeconds: null,
              }
            },
            async markWebChatRequestStarted() {
              events.push('started')
              return true
            },
            async finalizeWebChatRequest(_userId, _requestId, _owner, outcome, usage) {
              strictEqual(outcome, 'completed')
              deepStrictEqual(usage, {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                cachedInputTokens: null,
                cacheWriteTokens: null,
              })
              events.push('finished')
              return true
            },
          }),
        async startChat(options) {
          strictEqual(await options.quotaLifecycle?.markStarted(), true)
          strictEqual(
            await options.quotaLifecycle?.finalize('completed', {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              cachedInputTokens: null,
              cacheWriteTokens: null,
            }),
            true,
          )
          return new Response('data: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
        },
      }),
    )(request(undefined, { 'x-request-id': 'quota-request-1' }))

    strictEqual(response.status, 200)
    deepStrictEqual(events, ['claimed', 'started', 'finished'])
  },
)

Deno.test('webchat maps atomic quota decisions without calling the relay', async () => {
  for (const [decision, expectedStatus, expectedCode] of [
    ['member_access_denied', 403, 'chat_access_denied'],
    ['request_token_limited', 413, 'chat_request_token_limit'],
    ['requests_disabled', 503, 'chat_paused'],
    ['active_concurrent', 409, 'generation_in_progress'],
    ['minute_limited', 429, 'chat_minute_limited'],
    ['member_total_request_limited', 429, 'chat_total_request_limited'],
    ['member_total_token_limited', 429, 'chat_total_token_limited'],
    ['global_daily_request_limited', 503, 'chat_global_request_budget_exhausted'],
    ['global_daily_token_limited', 503, 'chat_global_token_budget_exhausted'],
    ['duplicate_active', 409, 'duplicate_request_active'],
    ['duplicate_terminal', 409, 'duplicate_request'],
    ['idempotency_conflict', 409, 'request_id_conflict'],
  ] as const) {
    let started = false
    const response = await createWebChatHandler(
      dependencies({
        createServices: () =>
          services({
            async claimWebChatRequest() {
              return {
                decision,
                status: 'blocked',
                remainingMinuteRequests: 0,
                remainingTotalRequests: 0,
                remainingTotalTokens: 0,
                retryAfterSeconds: decision === 'idempotency_conflict' ? null : 9,
              }
            },
          }),
        async startChat() {
          started = true
          return new Response()
        },
      }),
    )(request())
    strictEqual(response.status, expectedStatus)
    strictEqual(((await responseBody(response)).error as { code: string }).code, expectedCode)
    strictEqual(started, false)
  }
})

Deno.test('webchat sends only the first claimed global budget alert', async () => {
  let markerInput: unknown
  let notified: unknown
  const response = await createWebChatHandler(
    dependencies({
      createServices: () =>
        services({
          async claimWebChatRequest() {
            return {
              decision: 'global_daily_token_limited',
              status: 'blocked',
              remainingMinuteRequests: 2,
              remainingTotalRequests: 29,
              remainingTotalTokens: 90_000,
              retryAfterSeconds: 60,
            }
          },
          async claimWebChatBudgetAlert(input) {
            markerInput = input
            return {
              shouldNotify: true,
              budgetKind: 'tokens',
              usageDate: '2026-07-17',
              budgetLimit: 1_000_000,
              requestCount: 28,
              settledTokens: 940_000,
              reservedTokens: 40_000,
              attemptedReservedTokens: input.attemptedReservedTokens,
              observedUsage: 1_001_024,
              observedAt: '2026-07-17T10:00:00.000Z',
              resetAt: '2026-07-17T16:00:00.000Z',
            }
          },
          async notifyWebChatBudgetAlert(alert) {
            notified = alert
          },
        }),
    }),
  )(request())

  strictEqual(response.status, 503)
  strictEqual(
    ((await responseBody(response)).error as { code: string }).code,
    'chat_global_token_budget_exhausted',
  )
  strictEqual((markerInput as { budgetKind: string }).budgetKind, 'tokens')
  strictEqual((markerInput as { budgetLimit: number }).budgetLimit, 1_000_000)
  strictEqual(
    (markerInput as { attemptedReservedTokens: number }).attemptedReservedTokens > 0,
    true,
  )
  strictEqual((notified as { shouldNotify: boolean }).shouldNotify, true)
})

Deno.test('webchat preserves the quota response when budget alerting fails', async () => {
  const errors: unknown[] = []
  const response = await createWebChatHandler(
    dependencies({
      createServices: () =>
        services({
          async claimWebChatRequest() {
            return {
              decision: 'global_daily_request_limited',
              status: 'blocked',
              remainingMinuteRequests: 2,
              remainingTotalRequests: 29,
              remainingTotalTokens: 90_000,
              retryAfterSeconds: 60,
            }
          },
          async claimWebChatBudgetAlert() {
            throw new Error('budget marker unavailable')
          },
        }),
      async reportUnexpectedError(_request, error) {
        errors.push(error)
      },
    }),
  )(request())

  strictEqual(response.status, 503)
  strictEqual(
    ((await responseBody(response)).error as { code: string }).code,
    'chat_global_request_budget_exhausted',
  )
  strictEqual(errors.length, 1)
})

Deno.test('webchat does not report a member total limit as a global budget event', async () => {
  const checkedKinds: string[] = []
  const notifiedKinds: string[] = []
  const response = await createWebChatHandler(
    dependencies({
      createServices: () =>
        services({
          async claimWebChatRequest() {
            return {
              decision: 'member_total_request_limited',
              status: 'blocked',
              remainingMinuteRequests: 2,
              remainingTotalRequests: 0,
              remainingTotalTokens: 90_000,
              retryAfterSeconds: 60,
            }
          },
          async claimWebChatBudgetAlert(input) {
            checkedKinds.push(input.budgetKind)
            return {
              shouldNotify: input.budgetKind === 'requests',
              budgetKind: input.budgetKind,
              usageDate: '2026-07-17',
              budgetLimit: input.budgetLimit,
              requestCount: 30,
              settledTokens: 90_000,
              reservedTokens: 0,
              attemptedReservedTokens: input.attemptedReservedTokens,
              observedUsage:
                input.budgetKind === 'requests' ? 30 : 90_000 + input.attemptedReservedTokens,
              observedAt: '2026-07-17T10:00:00.000Z',
              resetAt: '2026-07-17T16:00:00.000Z',
            }
          },
          async notifyWebChatBudgetAlert(alert) {
            notifiedKinds.push(alert.budgetKind)
          },
        }),
    }),
  )(request())

  strictEqual(response.status, 429)
  strictEqual(
    ((await responseBody(response)).error as { code: string }).code,
    'chat_total_request_limited',
  )
  strictEqual(response.headers.get('retry-after'), null)
  deepStrictEqual(checkedKinds, [])
  deepStrictEqual(notifiedKinds, [])
})

Deno.test('webchat does not report a minute limit as a global budget event', async () => {
  const checkedKinds: string[] = []
  const response = await createWebChatHandler(
    dependencies({
      createServices: () =>
        services({
          async claimWebChatRequest() {
            return {
              decision: 'minute_limited',
              status: 'blocked',
              remainingMinuteRequests: 0,
              remainingTotalRequests: 29,
              remainingTotalTokens: 90_000,
              retryAfterSeconds: 60,
            }
          },
          async claimWebChatBudgetAlert(input) {
            checkedKinds.push(input.budgetKind)
            return {
              shouldNotify: false,
              budgetKind: input.budgetKind,
              usageDate: '2026-07-17',
              budgetLimit: input.budgetLimit,
              requestCount: 0,
              settledTokens: 0,
              reservedTokens: 0,
              attemptedReservedTokens: input.attemptedReservedTokens,
              observedUsage: input.attemptedReservedTokens,
              observedAt: '2026-07-17T10:00:00.000Z',
              resetAt: '2026-07-17T16:00:00.000Z',
            }
          },
        }),
    }),
  )(request())

  strictEqual(response.status, 429)
  strictEqual(
    ((await responseBody(response)).error as { code: string }).code,
    'chat_minute_limited',
  )
  deepStrictEqual(checkedKinds, [])
})

Deno.test('webchat releases only the pre-start claim when relay startup fails', async () => {
  let releases = 0
  const response = await createWebChatHandler(
    dependencies({
      createServices: () =>
        services({
          async releaseWebChatRequest(_userId, _requestId, _ownerToken, reason) {
            strictEqual(reason, 'start_failed_before_upstream')
            releases += 1
            return true
          },
        }),
      async startChat() {
        throw new WebChatUpstreamError(502, 'upstream_unavailable', '暂时不可用')
      },
    }),
  )(request())

  strictEqual(response.status, 502)
  strictEqual(releases, 1)
})

Deno.test(
  'webchat rejects a request whose conservative reservation exceeds the member total budget',
  async () => {
    let claimed = false
    const response = await createWebChatHandler(
      dependencies({
        createServices: () =>
          services({
            async readMemberRuntimeAccess() {
              return { ...memberAccess, totalTokenLimit: 100 }
            },
            async claimWebChatRequest() {
              claimed = true
              throw new Error('must not be called')
            },
          }),
      }),
    )(request())

    strictEqual(response.status, 413)
    strictEqual(claimed, false)
  },
)

Deno.test('webchat maps validation and upstream failures to structured safe errors', async () => {
  const invalid = await createWebChatHandler(dependencies())(
    request({ messages: [], model: 'client-model' }),
  )
  strictEqual(invalid.status, 400)

  const limited = await createWebChatHandler(
    dependencies({
      async startChat() {
        throw new WebChatUpstreamError(429, 'upstream_rate_limited', '稍后重试', '17')
      },
    }),
  )(request())
  strictEqual(limited.status, 429)
  strictEqual(limited.headers.get('cache-control'), 'private, no-store')
  strictEqual(limited.headers.get('retry-after'), '17')
  strictEqual(limited.headers.get('access-control-expose-headers')?.includes('retry-after'), true)
  deepStrictEqual((await responseBody(limited)).error, {
    code: 'upstream_rate_limited',
    message: '稍后重试',
  })
})

Deno.test(
  'webchat reports unexpected authorization failures without exposing details',
  async () => {
    const errors: unknown[] = []
    const response = await createWebChatHandler(
      dependencies({
        createServices: () =>
          services({
            async readMemberRuntimeAccess() {
              throw new Error('sensitive database transport detail')
            },
          }),
        async reportUnexpectedError(_request, error) {
          errors.push(error)
        },
      }),
    )(request())

    strictEqual(response.status, 500)
    strictEqual(JSON.stringify(await responseBody(response)).includes('sensitive'), false)
    strictEqual(errors.length, 1)
  },
)
