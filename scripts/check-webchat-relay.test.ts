import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  RelayCompatibilityError,
  parseRelayUsage,
  resolveResponsesEndpoint,
  runRelayCompatibility,
} from './check-webchat-relay.mjs'

const usage = { input_tokens: 12, output_tokens: 8, total_tokens: 20 }

function sse(events: unknown[], signal?: AbortSignal): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0
      const push = () => {
        if (signal?.aborted) {
          controller.error(new DOMException('aborted', 'AbortError'))
          return
        }
        const event = events[index]
        if (event === undefined) {
          controller.close()
          return
        }
        controller.enqueue(
          encoder.encode(
            `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        )
        index += 1
        setTimeout(push, 1)
      }
      push()
      signal?.addEventListener(
        'abort',
        () => controller.error(new DOMException('aborted', 'AbortError')),
        { once: true },
      )
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
}

function nonStreamingResponse() {
  return Response.json({
    id: 'resp-private',
    model: 'gpt-5.6-actual',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'compatibility output must stay private' }],
      },
    ],
    usage,
  })
}

function completedEvents() {
  return [
    { type: 'response.created', response: { model: 'gpt-5.6-actual' } },
    { type: 'response.output_text.delta', delta: 'first ' },
    { type: 'response.output_text.delta', delta: 'second' },
    {
      type: 'response.completed',
      response: { model: 'gpt-5.6-actual', usage },
    },
  ]
}

describe('WebChat relay compatibility checker', () => {
  it('accepts only a credential-free HTTPS base URL and appends the Responses endpoint', () => {
    expect(resolveResponsesEndpoint('https://relay.example/v1/').toString()).toBe(
      'https://relay.example/v1/responses',
    )
    for (const value of [
      'http://relay.example/v1',
      'https://user:pass@relay.example/v1',
      'https://relay.example/v1?key=secret',
    ]) {
      expect(() => resolveResponsesEndpoint(value)).toThrow(RelayCompatibilityError)
    }
  })

  it('parses only internally consistent terminal Usage', () => {
    expect(parseRelayUsage({ response: { usage } })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })
    expect(parseRelayUsage({ response: { usage: { ...usage, total_tokens: 1 } } })).toBeNull()
    expect(parseRelayUsage({ response: {} })).toBeNull()
  })

  it('validates non-streaming, typed SSE, Usage, and in-flight Abort without leaking content', async () => {
    const requests: Array<{ body: Record<string, unknown>; authorization: string | null }> = []
    let call = 0
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      call += 1
      requests.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get('authorization'),
      })
      if (call === 1) return nonStreamingResponse()
      if (call === 2) return sse(completedEvents(), init?.signal ?? undefined)
      return sse(
        [
          { type: 'response.created', response: { model: 'gpt-5.6-actual' } },
          { type: 'response.output_text.delta', delta: 'abort checkpoint' },
          { type: 'response.output_text.delta', delta: 'must not finish' },
        ],
        init?.signal ?? undefined,
      )
    })
    const reportPath = resolve('artifacts/test-webchat-relay-report.json')

    try {
      const report = await runRelayCompatibility({
        baseUrl: 'https://relay.example/v1',
        apiKey: 'secret-api-key',
        model: 'gpt-5.6',
        fetcher,
        timeoutMs: 5_000,
        abortSettleMs: 500,
        reportPath,
      })

      expect(report).toMatchObject({
        status: 'passed',
        relay: {
          path: '/v1/responses',
          requestedModel: 'gpt-5.6',
        },
        checks: {
          nonStreaming: { actualModel: 'gpt-5.6-actual' },
          streaming: {
            actualModel: 'gpt-5.6-actual',
            deltaCount: 2,
            terminalType: 'response.completed',
          },
          abort: { settleResult: 'aborted' },
        },
      })
      expect(requests).toHaveLength(3)
      expect(requests.every((request) => request.authorization === 'Bearer secret-api-key')).toBe(
        true,
      )
      expect(requests[0]?.body).toMatchObject({ model: 'gpt-5.6', store: false, stream: false })
      expect(requests[1]?.body).toMatchObject({ model: 'gpt-5.6', store: false, stream: true })

      const saved = await readFile(reportPath, 'utf8')
      expect(saved).not.toContain('secret-api-key')
      expect(saved).not.toContain('relay.example')
      expect(saved).not.toContain('compatibility output must stay private')
      expect(saved).not.toContain('resp-private')
    } finally {
      await rm(reportPath, { force: true })
    }
  })

  it('fails closed when the terminal stream omits Usage and writes a sanitized failure report', async () => {
    let call = 0
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      call += 1
      if (call === 1) return nonStreamingResponse()
      return sse(
        [
          { type: 'response.created', response: { model: 'gpt-5.6' } },
          { type: 'response.output_text.delta', delta: 'partial secret output' },
          { type: 'response.completed', response: { model: 'gpt-5.6' } },
        ],
        init?.signal ?? undefined,
      )
    })
    const reportPath = resolve('artifacts/test-webchat-relay-failure.json')

    try {
      await expect(
        runRelayCompatibility({
          baseUrl: 'https://relay.example/v1',
          apiKey: 'secret-api-key',
          model: 'gpt-5.6',
          fetcher,
          timeoutMs: 5_000,
          reportPath,
        }),
      ).rejects.toMatchObject({ code: 'stream_missing_usage' })
      const saved = await readFile(reportPath, 'utf8')
      expect(saved).toContain('stream_missing_usage')
      expect(saved).not.toContain('partial secret output')
      expect(saved).not.toContain('secret-api-key')
    } finally {
      await rm(reportPath, { force: true })
    }
  })
})
