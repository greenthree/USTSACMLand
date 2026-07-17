// deno-lint-ignore-file require-await
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import {
  createWebChatHandler,
  type WebChatHandlerDependencies,
  type WebChatServices,
} from './handler.ts'
import { type StartWebChatOptions, WebChatUpstreamError } from './upstream.ts'

const userId = '11111111-1111-4111-8111-111111111111'
const allowedOrigin = 'https://greenthree.github.io'

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
    async isProfileApproved() {
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

Deno.test('webchat authenticates the bearer token and requires an approved profile', async () => {
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
          async isProfileApproved(targetUserId) {
            strictEqual(targetUserId, userId)
            approvedChecks += 1
            return false
          },
        }),
    }),
  )(request())
  strictEqual(suspended.status, 403)
  strictEqual(approvedChecks, 1)
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
            async isProfileApproved() {
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
