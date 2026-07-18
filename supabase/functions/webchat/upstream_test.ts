// deno-lint-ignore-file require-await
import { deepStrictEqual, match, strictEqual } from 'node:assert/strict'
import {
  promptCacheKey,
  responsesInput,
  safetyIdentifier,
  startWebChat,
  supportsExplicitPromptCaching,
  type WebChatUpstreamConfig,
} from './upstream.ts'

const messages = [
  {
    id: 'user-1',
    role: 'user' as const,
    text: '解释二分答案',
  },
]
const usage = { input_tokens: 37, output_tokens: 11, total_tokens: 48 }

function sse(events: unknown[]): Response {
  return new Response(
    events
      .map(
        (event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function config(fetcher: typeof fetch): WebChatUpstreamConfig {
  return {
    baseUrl: 'https://relay.example.test/v1/',
    apiKey: 'server-only-key',
    model: 'gpt-5.6',
    systemPrompt: 'Server-owned prompt',
    promptVersion: 'usts-learning-assistant-v1',
    maxOutputTokens: 2048,
    timeoutMs: 5_000,
    fetcher,
  }
}

Deno.test('webchat hashes stable privacy-preserving safety identifiers', async () => {
  const first = await safetyIdentifier('11111111-1111-4111-8111-111111111111')
  const second = await safetyIdentifier('11111111-1111-4111-8111-111111111111')
  strictEqual(first, second)
  match(first, /^[a-f0-9]{64}$/)
})

Deno.test('webchat derives a stable model and prompt-version cache routing key', async () => {
  const first = await promptCacheKey('gpt-5.6', 'usts-learning-assistant-v1')
  const second = await promptCacheKey('gpt-5.6', 'usts-learning-assistant-v1')
  const changed = await promptCacheKey('gpt-5.6', 'usts-learning-assistant-v2')
  strictEqual(first, second)
  match(first, /^[a-f0-9]{64}$/)
  strictEqual(first === changed, false)
})

Deno.test(
  'webchat adds explicit historical breakpoints only for GPT-5.6 and later families',
  () => {
    strictEqual(supportsExplicitPromptCaching('gpt-5.6'), true)
    strictEqual(supportsExplicitPromptCaching('gpt-5.6-sol'), true)
    strictEqual(supportsExplicitPromptCaching('gpt-6.0'), true)
    strictEqual(supportsExplicitPromptCaching('gpt-5.5'), false)
    strictEqual(supportsExplicitPromptCaching('openai/gpt-5.6'), false)
    strictEqual(supportsExplicitPromptCaching('relay-custom-model'), false)
  },
)

Deno.test('webchat preserves explicit breakpoints on every historical user turn', () => {
  deepStrictEqual(
    responsesInput('gpt-5.6', [
      { id: 'user-1', role: 'user', text: '第一问' },
      { id: 'assistant-1', role: 'assistant', text: '第一答' },
      { id: 'user-2', role: 'user', text: '继续' },
    ]),
    [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '第一问',
            prompt_cache_breakpoint: { mode: 'explicit' },
          },
        ],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'input_text', text: '第一答' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '继续',
            prompt_cache_breakpoint: { mode: 'explicit' },
          },
        ],
      },
    ],
  )
})

Deno.test(
  'webchat uses the relay-compatible explicit cache policy and historical breakpoints',
  async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      strictEqual(new Headers(init?.headers).get('authorization'), 'Bearer server-only-key')
      strictEqual(init?.redirect, 'error')
      return sse([
        { type: 'response.output_text.delta', delta: '先找单调性。' },
        { type: 'response.completed', response: { usage } },
      ])
    }

    const response = await startWebChat(config(fetcher), {
      messages,
      userId: '11111111-1111-4111-8111-111111111111',
      requestId: 'request-1',
    })
    const output = await response.text()

    strictEqual(requestUrl, 'https://relay.example.test/v1/responses')
    deepStrictEqual(requestBody.input, [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '解释二分答案',
            prompt_cache_breakpoint: { mode: 'explicit' },
          },
        ],
      },
    ])
    strictEqual(requestBody.model, 'gpt-5.6')
    strictEqual(requestBody.instructions, 'Server-owned prompt')
    strictEqual(requestBody.max_output_tokens, 2048)
    strictEqual(requestBody.store, false)
    strictEqual(requestBody.stream, true)
    match(String(requestBody.prompt_cache_key), /^[a-f0-9]{64}$/)
    deepStrictEqual(requestBody.prompt_cache_options, { mode: 'explicit' })
    match(String(requestBody.safety_identifier), /^[a-f0-9]{64}$/)
    strictEqual('tools' in requestBody, false)
    strictEqual(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1')
    strictEqual(response.headers.get('x-usts-chat-prompt-version'), 'usts-learning-assistant-v1')
    strictEqual(response.headers.get('cache-control'), 'private, no-store, no-transform')
    match(output, /"type":"start"/)
    match(output, /"type":"text-delta".*先找单调性。/)
    match(output, /"type":"finish"/)
    match(output, /data: \[DONE\]/)
  },
)

Deno.test(
  'webchat marks the claim before fetch and finalizes trusted completion usage',
  async () => {
    const events: string[] = []
    const response = await startWebChat(
      config(async () => {
        events.push('fetch')
        return sse([
          { type: 'response.output_text.delta', delta: 'answer' },
          { type: 'response.completed', response: { usage } },
        ])
      }),
      {
        messages,
        userId: 'user-1',
        quotaLifecycle: {
          async markStarted() {
            events.push('mark')
            return true
          },
          async finalize(outcome, settledUsage) {
            strictEqual(outcome, 'completed')
            deepStrictEqual(settledUsage, {
              inputTokens: 37,
              outputTokens: 11,
              totalTokens: 48,
              cachedInputTokens: null,
              cacheWriteTokens: null,
            })
            events.push('finalize')
            return true
          },
        },
      },
    )

    await response.text()
    deepStrictEqual(events, ['mark', 'fetch', 'finalize'])
  },
)

Deno.test(
  'webchat keeps legacy implicit request shape for older and custom relay models',
  async () => {
    for (const model of ['gpt-5.5', 'openai/gpt-5.6', 'relay-custom-model']) {
      let requestBody: Record<string, unknown> = {}
      const response = await startWebChat(
        {
          ...config(async (_input, init) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
            return sse([{ type: 'response.completed', response: { usage } }])
          }),
          model,
        },
        { messages, userId: 'user-1' },
      )
      await response.text()
      deepStrictEqual(requestBody.input, [{ role: 'user', content: '解释二分答案' }])
      strictEqual('prompt_cache_options' in requestBody, false)
    }
  },
)

Deno.test('webchat never fetches after the database claim fence is lost', async () => {
  let fetched = false
  try {
    await startWebChat(
      config(async () => ((fetched = true), sse([]))),
      {
        messages,
        userId: 'user-1',
        quotaLifecycle: {
          async markStarted() {
            return false
          },
          async finalize() {
            throw new Error('must not finalize a claim that never started')
          },
        },
      },
    )
    throw new Error('expected lost claim')
  } catch (error) {
    strictEqual((error as { code: string }).code, 'quota_claim_expired')
    strictEqual(fetched, false)
  }
})

Deno.test('webchat cleans up abort listeners when marking the claim fails', async () => {
  const controller = new AbortController()
  const signal = controller.signal
  const originalAdd = signal.addEventListener.bind(signal)
  const originalRemove = signal.removeEventListener.bind(signal)
  let added = 0
  let removed = 0
  Object.defineProperty(signal, 'addEventListener', {
    value: (...args: Parameters<AbortSignal['addEventListener']>) => {
      added += 1
      return originalAdd(...args)
    },
  })
  Object.defineProperty(signal, 'removeEventListener', {
    value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
      removed += 1
      return originalRemove(...args)
    },
  })

  let fetched = false
  try {
    await startWebChat(
      config(async () => ((fetched = true), sse([]))),
      {
        messages,
        userId: 'user-1',
        requestSignal: signal,
        quotaLifecycle: {
          async markStarted() {
            throw new Error('database transport failed')
          },
          async finalize() {
            throw new Error('must not finalize a claim with an unknown mark result')
          },
        },
      },
    )
    throw new Error('expected mark failure')
  } catch (error) {
    match(String(error), /database transport failed/)
  }

  strictEqual(fetched, false)
  strictEqual(added, 1)
  strictEqual(removed, 1)
})

Deno.test('webchat maps upstream HTTP failures without exposing response bodies', async () => {
  for (const [status, expectedStatus, expectedCode] of [
    [401, 502, 'upstream_unavailable'],
    [429, 429, 'upstream_rate_limited'],
    [500, 502, 'upstream_unavailable'],
  ] as const) {
    try {
      await startWebChat(
        config(async () => new Response('sensitive relay detail', { status })),
        { messages, userId: 'user-1' },
      )
      throw new Error('expected upstream error')
    } catch (error) {
      strictEqual((error as { status: number }).status, expectedStatus)
      strictEqual((error as { code: string }).code, expectedCode)
      strictEqual(String(error).includes('sensitive relay detail'), false)
    }
  }
})

Deno.test('webchat surfaces malformed or interrupted SSE as a safe UI stream error', async () => {
  for (const response of [
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    sse([{ type: 'response.output_text.delta', delta: 'partial' }]),
  ]) {
    try {
      const result = await startWebChat(
        config(async () => response),
        {
          messages,
          userId: 'user-1',
        },
      )
      const output = await result.text()
      match(output, /AI 回复中断/)
      strictEqual(output.includes('partial') || response.headers.get('content-type') === null, true)
    } catch (error) {
      strictEqual((error as { code: string }).code, 'upstream_protocol_error')
    }
  }
})

Deno.test(
  'webchat forwards model refusals as visible text instead of an empty success',
  async () => {
    const response = await startWebChat(
      config(async () =>
        sse([
          { type: 'response.refusal.delta', delta: '我不能协助当前赛中解题。' },
          { type: 'response.completed', response: { usage } },
        ]),
      ),
      { messages, userId: 'user-1' },
    )

    const output = await response.text()
    match(output, /"type":"text-delta".*我不能协助当前赛中解题。/)
    match(output, /"finishReason":"stop"/)
  },
)

Deno.test('webchat preserves Responses API incomplete reasons in the UI finish event', async () => {
  for (const [reason, finishReason] of [
    ['max_output_tokens', 'length'],
    ['content_filter', 'content-filter'],
  ] as const) {
    const response = await startWebChat(
      config(async () =>
        sse([
          { type: 'response.output_text.delta', delta: 'partial' },
          {
            type: 'response.incomplete',
            response: { incomplete_details: { reason }, usage },
          },
        ]),
      ),
      { messages, userId: 'user-1' },
    )
    match(await response.text(), new RegExp(`"finishReason":"${finishReason}"`))
  }
})

Deno.test('webchat reports stream protocol failures after headers are returned', async () => {
  const errors: unknown[] = []
  const response = await startWebChat(
    config(async () =>
      sse([
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'unknown_reason' }, usage },
        },
      ]),
    ),
    {
      messages,
      userId: 'user-1',
      async reportUnexpectedError(error) {
        errors.push(error)
      },
    },
  )

  match(await response.text(), /AI 回复中断/)
  strictEqual(errors.length, 1)
})

Deno.test('webchat times out one upstream request without retrying it', async () => {
  let fetchCount = 0
  const settlements: Array<{ outcome: string; usage: unknown }> = []
  const fetcher: typeof fetch = async (_input, init) => {
    fetchCount += 1
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      )
    })
  }

  try {
    await startWebChat(
      { ...config(fetcher), timeoutMs: 1 },
      {
        messages,
        userId: 'user-1',
        quotaLifecycle: {
          async markStarted() {
            return true
          },
          async finalize(outcome, settledUsage) {
            settlements.push({ outcome, usage: settledUsage })
            return true
          },
        },
      },
    )
    throw new Error('expected timeout')
  } catch (error) {
    strictEqual((error as { status: number }).status, 504)
    strictEqual((error as { code: string }).code, 'upstream_timeout')
    strictEqual(fetchCount, 1)
    deepStrictEqual(settlements, [{ outcome: 'upstream_timeout', usage: null }])
  }
})

Deno.test(
  'webchat cancels the single upstream request when the client stream is cancelled',
  async () => {
    let upstreamCancelled = false
    const settlements: Array<{ outcome: string; usage: unknown }> = []
    const upstream = new ReadableStream<Uint8Array>({
      cancel() {
        upstreamCancelled = true
      },
    })
    const response = await startWebChat(
      config(
        async () =>
          new Response(upstream, {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
      {
        messages,
        userId: 'user-1',
        quotaLifecycle: {
          async markStarted() {
            return true
          },
          async finalize(outcome, settledUsage) {
            settlements.push({ outcome, usage: settledUsage })
            return true
          },
        },
      },
    )

    await response.body?.cancel('user stopped')
    strictEqual(upstreamCancelled, true)
    deepStrictEqual(settlements, [{ outcome: 'request_aborted', usage: null }])
  },
)

Deno.test('webchat rejects credentialed or non-HTTPS relay URLs before fetch', async () => {
  for (const baseUrl of ['http://relay.example.test/v1', 'https://user:pass@relay.example.test']) {
    let fetched = false
    try {
      await startWebChat(
        { ...config(async () => ((fetched = true), sse([]))), baseUrl },
        { messages, userId: 'user-1' },
      )
      throw new Error('expected URL validation error')
    } catch {
      strictEqual(fetched, false)
    }
  }
})
