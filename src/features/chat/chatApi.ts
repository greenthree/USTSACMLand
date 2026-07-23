import { DefaultChatTransport, type UIMessage } from 'ai'
import { demoAuthEnabled, supabase, supabaseAnonKey, supabaseUrl } from '../../lib/supabase'

interface WebChatErrorPayload {
  error?: {
    code?: unknown
    message?: unknown
  }
  requestId?: unknown
}

const MAX_WEBCHAT_MESSAGE_CHARS = 12_000
const TOOL_PROTOCOL_PATTERN = /(?:\/\*\s*)?TOOLCALL\s+(?:START|END)\s*:/i
const WEBCHAT_ATTACHMENT_URN_PATTERN =
  /^urn:ustsacm:webchat-attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface WebChatTransportOptions {
  apiUrl: string
  anonKey: string
  getAccessToken: () => Promise<string | null>
  getConversationId?: () => Promise<string | null>
  createRequestId?: () => string
  fetch?: typeof globalThis.fetch
}

export interface WebChatApiUrlOptions {
  configuredUrl?: string | null
  supabaseUrl?: string | null
  browserOrigin?: string | null
  allowInsecureLoopback?: boolean
}

export class WebChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly requestId: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'WebChatApiError'
  }

  get retryable(): boolean {
    return this.code === 'network_error' || this.status === 502 || this.status === 504
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null
}

function publicErrorMessage(status: number, payload: WebChatErrorPayload | null): string {
  const message = payload?.error?.message
  if (typeof message === 'string' && message.trim()) return message.trim()
  if (status === 401) return '登录状态已失效，请重新登录。'
  if (status === 403) return '当前账号不能使用 AI 学习助手。'
  if (status === 409) return '已有请求正在处理，请稍后再试。'
  if (status === 413) return '当前对话内容过长，请清空部分内容后重试。'
  if (status === 429) return '使用额度或当前时段已达到上限。'
  if (status === 503) return 'AI 学习助手尚未开放。'
  return 'AI 学习助手暂时不可用，请稍后重试。'
}

async function parseErrorResponse(response: Response): Promise<WebChatApiError> {
  let payload: WebChatErrorPayload | null = null
  try {
    const candidate: unknown = await response.clone().json()
    if (isRecord(candidate)) payload = candidate as WebChatErrorPayload
  } catch {
    // Non-JSON upstream errors are intentionally replaced by a stable public message.
  }

  const code =
    typeof payload?.error?.code === 'string' && payload.error.code.trim()
      ? payload.error.code.trim()
      : `http_${response.status}`
  const requestId =
    typeof payload?.requestId === 'string' && payload.requestId.trim()
      ? payload.requestId.trim()
      : response.headers.get('x-request-id')?.trim() || null

  return new WebChatApiError(
    publicErrorMessage(response.status, payload),
    response.status,
    code,
    requestId,
    parseRetryAfter(response.headers.get('retry-after')),
  )
}

export function requestMessages(messages: UIMessage[]) {
  return messages.flatMap((message) => {
    const parts: Array<
      { type: 'text'; text: string } | { type: 'file'; mediaType: 'image/webp'; url: string }
    > = []
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) {
        parts.push({ type: 'text', text: part.text })
        continue
      }
      if (
        message.role === 'user' &&
        part.type === 'file' &&
        part.mediaType === 'image/webp' &&
        WEBCHAT_ATTACHMENT_URN_PATTERN.test(part.url)
      ) {
        parts.push({ type: 'file', mediaType: 'image/webp', url: part.url })
      }
    }
    const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')

    if (
      message.role === 'assistant' &&
      (TOOL_PROTOCOL_PATTERN.test(text) || Array.from(text).length > MAX_WEBCHAT_MESSAGE_CHARS)
    ) {
      return []
    }

    return [{ id: message.id, role: message.role, parts }]
  })
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function normalizeWebChatError(error: unknown): WebChatApiError {
  if (error instanceof WebChatApiError) return error
  if (error instanceof Error && error.message.trim()) {
    return new WebChatApiError(error.message, null, 'client_error')
  }
  return new WebChatApiError('AI 学习助手暂时不可用，请稍后重试。', null, 'client_error')
}

export function resolveWebChatApiUrl({
  configuredUrl,
  supabaseUrl: configuredSupabaseUrl,
  browserOrigin,
  allowInsecureLoopback = false,
}: WebChatApiUrlOptions): string {
  const explicit = configuredUrl?.trim()
  if (!explicit) {
    return configuredSupabaseUrl
      ? `${configuredSupabaseUrl.replace(/\/+$/, '')}/functions/v1/webchat`
      : '/functions/v1/webchat'
  }

  let url: URL
  try {
    url = new URL(explicit, browserOrigin ?? undefined)
  } catch {
    throw new Error('VITE_WEBCHAT_API_URL 必须是有效的 URL。')
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  const expectedSupabaseEndpoint = configuredSupabaseUrl
    ? new URL(
        `${configuredSupabaseUrl.replace(/\/+$/, '')}/functions/v1/webchat`,
        browserOrigin ?? undefined,
      )
    : null
  const matchesSupabaseEndpoint =
    expectedSupabaseEndpoint !== null &&
    url.origin === expectedSupabaseEndpoint.origin &&
    url.pathname.replace(/\/+$/, '') === expectedSupabaseEndpoint.pathname.replace(/\/+$/, '')
  const localDevelopmentOverride =
    allowInsecureLoopback && loopback && (url.protocol === 'http:' || url.protocol === 'https:')
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !localDevelopmentOverride) ||
    (!matchesSupabaseEndpoint && !localDevelopmentOverride)
  ) {
    throw new Error(
      'VITE_WEBCHAT_API_URL 必须指向当前 Supabase 项目的 webchat 函数；仅本地开发可使用回环地址。',
    )
  }
  return url.toString()
}

export function createWebChatTransport({
  apiUrl,
  anonKey,
  getAccessToken,
  getConversationId,
  createRequestId = () => crypto.randomUUID(),
  fetch: fetchImplementation = globalThis.fetch.bind(globalThis),
}: WebChatTransportOptions): DefaultChatTransport<UIMessage> {
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    let response: Response
    try {
      response = await fetchImplementation(input, init)
    } catch (error) {
      if (abortError(error)) throw error
      throw new WebChatApiError('网络连接失败，请检查连接后重试。', null, 'network_error')
    }

    if (!response.ok) throw await parseErrorResponse(response)
    return response
  }

  return new DefaultChatTransport<UIMessage>({
    api: apiUrl,
    credentials: 'omit',
    fetch: guardedFetch,
    prepareSendMessagesRequest: async ({ id, messages, trigger, messageId }) => {
      const [accessToken, conversationId] = await Promise.all([
        getAccessToken(),
        getConversationId?.() ?? Promise.resolve(null),
      ])
      if (!accessToken) {
        throw new WebChatApiError('登录状态已失效，请重新登录。', 401, 'unauthorized')
      }

      return {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          'x-request-id': createRequestId(),
        },
        body: {
          id: conversationId ?? id,
          messages: requestMessages(messages),
          trigger,
          messageId,
        },
      }
    },
  })
}

export async function currentWebChatAccessToken(): Promise<string | null> {
  if (!supabase) return demoAuthEnabled ? 'ustsacmland-demo-webchat-token' : null
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw new WebChatApiError('无法刷新登录状态，请重新登录。', 401, 'session_refresh_failed')
  }
  return data.session?.access_token ?? null
}

export function createBrowserWebChatTransport(options?: {
  getConversationId?: () => Promise<string | null>
}): DefaultChatTransport<UIMessage> {
  const apiUrl = resolveWebChatApiUrl({
    configuredUrl: import.meta.env.VITE_WEBCHAT_API_URL,
    supabaseUrl,
    browserOrigin: typeof window === 'undefined' ? null : window.location.origin,
    allowInsecureLoopback: import.meta.env.DEV,
  })

  return createWebChatTransport({
    apiUrl,
    anonKey: supabaseAnonKey ?? '',
    getAccessToken: currentWebChatAccessToken,
    getConversationId: options?.getConversationId,
  })
}
