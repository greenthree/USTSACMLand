import { parseWebChatUsage, type WebChatUsage } from './quota.ts'

export interface WebChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export interface WebChatQuotaLifecycle {
  markStarted(): Promise<boolean>
  finalize(outcome: string, usage: WebChatUsage | null): Promise<boolean>
}

export interface StartWebChatOptions {
  messages: WebChatMessage[]
  userId: string
  requestSignal?: AbortSignal
  requestId?: string | null
  quotaLifecycle?: WebChatQuotaLifecycle
  reportUnexpectedError?: (error: unknown) => Promise<void>
}

export interface WebChatUpstreamConfig {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  promptVersion: string
  maxOutputTokens: number
  timeoutMs: number
  fetcher?: typeof fetch
}

export class WebChatUpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter: string | null = null,
  ) {
    super(message)
  }
}

const encoder = new TextEncoder()

export function responsesEndpoint(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('CHAT_RELAY_BASE_URL must be a valid URL')
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('CHAT_RELAY_BASE_URL must be a credential-free HTTPS URL')
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/responses`
  return url.toString()
}

function uiChunk(value: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
}

function uiDone(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n')
}

function eventData(block: string): string | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
  return data || null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function safetyIdentifier(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(userId))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function promptCacheKey(model: string, promptVersion: string): Promise<string> {
  return safetyIdentifier(`usts-acm-land:webchat:${model}:${promptVersion}`)
}

function upstreamError(response: Response): WebChatUpstreamError {
  if (response.status === 429) {
    return new WebChatUpstreamError(
      429,
      'upstream_rate_limited',
      'AI 服务当前请求过多，请稍后重试',
      response.headers.get('retry-after'),
    )
  }
  if (response.status === 408 || response.status === 504) {
    return new WebChatUpstreamError(504, 'upstream_timeout', 'AI 服务响应超时，请重试')
  }
  return new WebChatUpstreamError(502, 'upstream_unavailable', 'AI 服务暂时不可用，请稍后重试')
}

export async function startWebChat(
  config: WebChatUpstreamConfig,
  options: StartWebChatOptions,
): Promise<Response> {
  const endpoint = responsesEndpoint(config.baseUrl)
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(config.promptVersion)) {
    throw new Error('CHAT_SYSTEM_PROMPT_VERSION has an invalid format')
  }
  const fetcher = config.fetcher ?? fetch
  const safetyId = await safetyIdentifier(options.userId)
  const cacheKey = await promptCacheKey(config.model, config.promptVersion)
  const abortController = new AbortController()
  const abortFromRequest = () => abortController.abort(options.requestSignal?.reason)
  if (options.requestSignal?.aborted) abortFromRequest()
  else {
    options.requestSignal?.addEventListener('abort', abortFromRequest, {
      once: true,
    })
  }

  const timeout = setTimeout(
    () => abortController.abort(new DOMException('Upstream timed out', 'TimeoutError')),
    config.timeoutMs,
  )
  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    clearTimeout(timeout)
    options.requestSignal?.removeEventListener('abort', abortFromRequest)
  }

  let quotaSettled = false
  const finalizeQuota = async (outcome: string, usage: WebChatUsage | null) => {
    if (!options.quotaLifecycle || quotaSettled) return
    quotaSettled = true
    if (!(await options.quotaLifecycle.finalize(outcome, usage))) {
      throw new Error('WebChat quota claim could not be finalized')
    }
  }
  const finalizeUnknownSafely = async (outcome: string) => {
    try {
      await finalizeQuota(outcome, null)
    } catch (error) {
      await options.reportUnexpectedError?.(error)
    }
  }

  if (options.quotaLifecycle) {
    let markedStarted: boolean
    try {
      markedStarted = await options.quotaLifecycle.markStarted()
    } catch (error) {
      cleanup()
      throw error
    }
    if (!markedStarted) {
      cleanup()
      throw new WebChatUpstreamError(409, 'quota_claim_expired', '请求等待时间过长，请重新发送')
    }
  }

  let upstream: Response
  try {
    upstream = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        instructions: config.systemPrompt,
        input: options.messages.map(({ role, text }) => ({
          role,
          content: text,
        })),
        max_output_tokens: config.maxOutputTokens,
        prompt_cache_key: cacheKey,
        safety_identifier: safetyId,
        store: false,
        stream: true,
      }),
      redirect: 'error',
      signal: abortController.signal,
    })
  } catch {
    cleanup()
    if (options.requestSignal?.aborted) {
      await finalizeUnknownSafely('request_aborted')
      throw new WebChatUpstreamError(499, 'request_aborted', '请求已取消')
    }
    if (abortController.signal.aborted) {
      await finalizeUnknownSafely('upstream_timeout')
      throw new WebChatUpstreamError(504, 'upstream_timeout', 'AI 服务响应超时，请重试')
    }
    await finalizeUnknownSafely('upstream_unavailable')
    throw new WebChatUpstreamError(502, 'upstream_unavailable', 'AI 服务暂时不可用，请稍后重试')
  }

  if (!upstream.ok) {
    cleanup()
    await upstream.body?.cancel().catch(() => undefined)
    await finalizeUnknownSafely('upstream_http_error')
    throw upstreamError(upstream)
  }
  if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
    cleanup()
    await upstream.body?.cancel().catch(() => undefined)
    await finalizeUnknownSafely('upstream_protocol_error')
    throw new WebChatUpstreamError(502, 'upstream_protocol_error', 'AI 服务返回了无法识别的响应')
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const messageId = crypto.randomUUID()
  const textId = `${messageId}-text`
  let downstreamClosed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(uiChunk({ type: 'start', messageId }))
      controller.enqueue(uiChunk({ type: 'text-start', id: textId }))

      void (async () => {
        let buffer = ''
        let completed = false
        let completionUsage: WebChatUsage | null = null
        let completionOutcome = 'completed'
        let finishReason: 'stop' | 'length' | 'content-filter' = 'stop'
        try {
          while (true) {
            const { done, value } = await reader.read()
            buffer += decoder.decode(value, { stream: !done })

            while (true) {
              const separator = buffer.match(/\r?\n\r?\n/)
              if (!separator || separator.index === undefined) break
              const block = buffer.slice(0, separator.index)
              buffer = buffer.slice(separator.index + separator[0].length)
              const data = eventData(block)
              if (!data || data === '[DONE]') continue

              let event: Record<string, unknown> | null
              try {
                event = asRecord(JSON.parse(data))
              } catch {
                throw new Error('invalid upstream SSE JSON')
              }
              if (!event || typeof event.type !== 'string') {
                throw new Error('invalid upstream SSE event')
              }
              if (
                event.type === 'response.output_text.delta' ||
                event.type === 'response.refusal.delta'
              ) {
                if (typeof event.delta !== 'string') {
                  throw new Error('invalid text delta')
                }
                if (event.delta) {
                  controller.enqueue(
                    uiChunk({
                      type: 'text-delta',
                      id: textId,
                      delta: event.delta,
                    }),
                  )
                }
              } else if (event.type === 'response.completed') {
                completionUsage = parseWebChatUsage(event)
                completed = true
              } else if (event.type === 'response.incomplete') {
                const response = asRecord(event.response)
                const details = asRecord(response?.incomplete_details)
                if (details?.reason === 'max_output_tokens') {
                  finishReason = 'length'
                  completionOutcome = 'incomplete_max_output_tokens'
                } else if (details?.reason === 'content_filter') {
                  finishReason = 'content-filter'
                  completionOutcome = 'incomplete_content_filter'
                } else throw new Error('unknown incomplete response reason')
                completionUsage = parseWebChatUsage(event)
                completed = true
              } else if (event.type === 'response.failed' || event.type === 'error') {
                throw new Error('upstream response failed')
              }
            }

            if (done) break
          }

          if (!completed) {
            throw new Error('upstream stream ended before completion')
          }
          if (!completionUsage) {
            throw new Error('upstream completion did not include token usage')
          }
          await finalizeQuota(completionOutcome, completionUsage)
          if (downstreamClosed) return
          controller.enqueue(uiChunk({ type: 'text-end', id: textId }))
          controller.enqueue(uiChunk({ type: 'finish', finishReason }))
          controller.enqueue(uiDone())
          downstreamClosed = true
          controller.close()
        } catch (error) {
          const interruptedOutcome = options.requestSignal?.aborted
            ? 'request_aborted'
            : abortController.signal.aborted
              ? 'upstream_timeout'
              : 'stream_interrupted'
          await finalizeUnknownSafely(interruptedOutcome)
          if (downstreamClosed || options.requestSignal?.aborted) return
          await options.reportUnexpectedError?.(error)
          controller.enqueue(uiChunk({ type: 'text-end', id: textId }))
          controller.enqueue(
            uiChunk({
              type: 'error',
              errorText: 'AI 回复中断，请保留问题后重试。',
            }),
          )
          controller.enqueue(uiDone())
          downstreamClosed = true
          controller.close()
        } finally {
          cleanup()
          await reader.cancel().catch(() => undefined)
        }
      })()
    },
    async cancel(reason) {
      downstreamClosed = true
      abortController.abort(reason)
      cleanup()
      await finalizeUnknownSafely('request_aborted')
      await reader.cancel(reason).catch(() => undefined)
    },
  })

  return new Response(stream, {
    headers: {
      'cache-control': 'private, no-store, no-transform',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-usts-chat-prompt-version': config.promptVersion,
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  })
}
