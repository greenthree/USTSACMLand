import type { UIMessage } from 'ai'
import { createWebChatTransport, resolveWebChatApiUrl } from './chatApi'

const messages: UIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    metadata: { localOnly: true },
    parts: [{ type: 'text', text: '如何判断二分答案？' }],
  },
]

function send(transport: ReturnType<typeof createWebChatTransport>) {
  return transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: 'user-1',
    messages,
    abortSignal: undefined,
  })
}

function streamResponse() {
  return new Response('data: {"type":"finish","finishReason":"stop"}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('WebChat browser transport', () => {
  it('keeps production access tokens on the current Supabase function endpoint', () => {
    expect(
      resolveWebChatApiUrl({
        configuredUrl: 'https://project.supabase.co/functions/v1/webchat',
        supabaseUrl: 'https://project.supabase.co',
      }),
    ).toBe('https://project.supabase.co/functions/v1/webchat')
    expect(
      resolveWebChatApiUrl({
        configuredUrl: 'http://127.0.0.1:4174/api/chat',
        allowInsecureLoopback: true,
      }),
    ).toBe('http://127.0.0.1:4174/api/chat')
    expect(
      resolveWebChatApiUrl({
        supabaseUrl: 'https://project.supabase.co/',
      }),
    ).toBe('https://project.supabase.co/functions/v1/webchat')
    expect(resolveWebChatApiUrl({})).toBe('/functions/v1/webchat')

    for (const configuredUrl of [
      'https://api.example.edu.cn/api/chat',
      'https://project.supabase.co/functions/v1/other-function',
      'http://api.example.edu.cn/api/chat',
      'https://user:pass@api.example.edu.cn/api/chat',
      'https://api.example.edu.cn/api/chat?key=secret',
    ]) {
      expect(() =>
        resolveWebChatApiUrl({
          configuredUrl,
          supabaseUrl: 'https://project.supabase.co',
        }),
      ).toThrow(/VITE_WEBCHAT_API_URL/)
    }
  })

  it('reads a fresh access token and creates a fresh request id for every send', async () => {
    const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = []
    const tokens = ['token-a', 'token-b']
    const requestIds = ['request-a', 'request-b']
    const fetchMock: typeof fetch = vi.fn(async (_input, init) => {
      requests.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return streamResponse()
    })
    const transport = createWebChatTransport({
      apiUrl: 'https://example.supabase.co/functions/v1/webchat',
      anonKey: 'public-anon-key',
      getAccessToken: async () => tokens.shift() ?? null,
      createRequestId: () => requestIds.shift() ?? 'unexpected',
      fetch: fetchMock,
    })

    await send(transport)
    await send(transport)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer token-a',
      'Bearer token-b',
    ])
    expect(requests.map((request) => request.headers.get('x-request-id'))).toEqual([
      'request-a',
      'request-b',
    ])
    expect(requests[0]?.headers.get('apikey')).toBe('public-anon-key')
    expect(requests[0]?.body).toEqual({
      id: 'chat-1',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '如何判断二分答案？' }],
        },
      ],
      trigger: 'submit-message',
      messageId: 'user-1',
    })
  })

  it('maps structured quota failures without automatically retrying', async () => {
    const fetchMock: typeof fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'chat_minute_limited', message: '发送过于频繁，请稍后再试' },
            requestId: 'quota-request-1',
          }),
          { status: 429, headers: { 'retry-after': '17', 'content-type': 'application/json' } },
        ),
      ),
    )
    const transport = createWebChatTransport({
      apiUrl: 'https://example.supabase.co/functions/v1/webchat',
      anonKey: 'public-anon-key',
      getAccessToken: async () => 'token',
      fetch: fetchMock,
    })

    await expect(send(transport)).rejects.toMatchObject({
      name: 'WebChatApiError',
      status: 429,
      code: 'chat_minute_limited',
      requestId: 'quota-request-1',
      retryAfterSeconds: 17,
      retryable: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps exhausted cumulative member quota non-retryable without a reset delay', async () => {
    const fetchMock: typeof fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 'chat_total_request_limited',
              message: 'AI 助手累计请求次数已用完',
            },
            requestId: 'total-quota-request-1',
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    const transport = createWebChatTransport({
      apiUrl: 'https://example.supabase.co/functions/v1/webchat',
      anonKey: 'public-anon-key',
      getAccessToken: async () => 'token',
      fetch: fetchMock,
    })

    await expect(send(transport)).rejects.toMatchObject({
      status: 429,
      code: 'chat_total_request_limited',
      requestId: 'total-quota-request-1',
      retryAfterSeconds: null,
      retryable: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects missing sessions before making a network request', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => streamResponse())
    const transport = createWebChatTransport({
      apiUrl: 'https://example.supabase.co/functions/v1/webchat',
      anonKey: 'public-anon-key',
      getAccessToken: async () => null,
      fetch: fetchMock,
    })

    await expect(send(transport)).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a network error after one attempt', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => {
      throw new TypeError('connection reset')
    })
    const transport = createWebChatTransport({
      apiUrl: 'https://example.supabase.co/functions/v1/webchat',
      anonKey: 'public-anon-key',
      getAccessToken: async () => 'token',
      fetch: fetchMock,
    })

    await expect(send(transport)).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
