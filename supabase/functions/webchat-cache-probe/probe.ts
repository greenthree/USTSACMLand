import {
  promptCacheKey,
  responsesEndpoint,
  responsesInput,
  type WebChatMessage,
} from '../webchat/upstream.ts'

const CACHE_PROBE_REPETITIONS = 768
const CACHE_PROBE_MAX_OUTPUT_TOKENS = 16
const CACHE_PROBE_MAX_SSE_BYTES = 262_144
const encoder = new TextEncoder()

export interface CacheProbeRuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  promptVersion: string
  timeoutMs: number
  stream?: boolean
  cachePolicy?: CacheProbePolicy
  fetcher?: typeof fetch
}

export type CacheProbePolicy = 'default_implicit' | 'declared_implicit'

export interface CacheProbeUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number | null
}

export interface CacheProbeObservation {
  durationMs: number
  usage: CacheProbeUsage
}

export interface CacheProbeResult {
  model: string
  transport: 'streaming' | 'non_streaming'
  cachePolicy: CacheProbePolicy
  first: CacheProbeObservation
  second: CacheProbeObservation
  aggregateUsage: CacheProbeUsage
  reusedInputTokens: number
}

export class CacheProbeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 502,
    readonly knownResult: CacheProbeResult | null = null,
  ) {
    super(message)
    this.name = 'CacheProbeError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function parseCacheProbeUsage(value: unknown): CacheProbeUsage | null {
  const payload = asRecord(value)
  const response = asRecord(payload?.response) ?? payload
  const usage = asRecord(response?.usage)
  const details = asRecord(usage?.input_tokens_details)
  const inputTokens = nonnegativeInteger(usage?.input_tokens)
  const outputTokens = nonnegativeInteger(usage?.output_tokens)
  const totalTokens = nonnegativeInteger(usage?.total_tokens)
  const cachedInputTokens = nonnegativeInteger(details?.cached_tokens)
  const cacheWriteTokens =
    details?.cache_write_tokens === undefined || details.cache_write_tokens === null
      ? null
      : nonnegativeInteger(details.cache_write_tokens)

  if (
    inputTokens === null ||
    outputTokens === null ||
    totalTokens === null ||
    cachedInputTokens === null ||
    (details?.cache_write_tokens !== undefined &&
      details.cache_write_tokens !== null &&
      cacheWriteTokens === null) ||
    totalTokens !== inputTokens + outputTokens ||
    cachedInputTokens > inputTokens
  ) {
    return null
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheWriteTokens,
  }
}

function probeInput(): string {
  const stablePrefix = Array.from(
    { length: CACHE_PROBE_REPETITIONS },
    () => 'cache probe validation',
  ).join(' ')
  return `${stablePrefix}\nReply only with OK.`
}

function probeMessages(includeFollowUp: boolean): WebChatMessage[] {
  const messages: WebChatMessage[] = [
    {
      id: 'cache-probe-user-1',
      role: 'user',
      text: probeInput(),
    },
  ]
  if (includeFollowUp) {
    messages.push(
      {
        id: 'cache-probe-assistant-1',
        role: 'assistant',
        text: 'OK',
      },
      {
        id: 'cache-probe-user-2',
        role: 'user',
        text: 'Confirm the same instruction by replying only with OK.',
      },
    )
  }
  return messages
}

async function requestBody(
  model: string,
  promptVersion: string,
  includeFollowUp: boolean,
  stream: boolean,
  cachePolicy: CacheProbePolicy,
): Promise<Record<string, unknown>> {
  return {
    model,
    instructions:
      'This is an automated prompt-cache verification request. Follow the final instruction exactly.',
    input: responsesInput(probeMessages(includeFollowUp)),
    max_output_tokens: CACHE_PROBE_MAX_OUTPUT_TOKENS,
    // Use the same routing key as real member traffic. The probe prompt stays
    // synthetic, so it cannot reuse or expose member conversation content.
    prompt_cache_key: await promptCacheKey(model, promptVersion),
    ...(cachePolicy === 'declared_implicit'
      ? { prompt_cache_options: { mode: 'implicit', ttl: '30m' } }
      : {}),
    store: false,
    stream,
  }
}

export async function cacheProbeReservationTokens(
  model: string,
  promptVersion: string,
  stream = true,
  cachePolicy: CacheProbePolicy = 'declared_implicit',
): Promise<number> {
  const bodies = await Promise.all([
    requestBody(model, promptVersion, false, stream, cachePolicy),
    requestBody(model, promptVersion, true, stream, cachePolicy),
  ])
  const encodedBytes = bodies.reduce(
    (total, body) => total + encoder.encode(JSON.stringify(body)).byteLength,
    0,
  )
  // A token must consume at least one encoded byte. Reserve two complete
  // requests, their maximum outputs, and provider framing that is not visible
  // in the JSON payload so an honest Usage response cannot exceed the claim.
  const reservation = encodedBytes + (CACHE_PROBE_MAX_OUTPUT_TOKENS + 1_024) * bodies.length
  if (!Number.isSafeInteger(reservation) || reservation < 1_024 || reservation > 1_000_000) {
    throw new CacheProbeError('reservation_invalid', 'Cache probe reservation is invalid', 500)
  }
  return reservation
}

function eventData(block: string): string | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
  return data || null
}

async function parseStreamingUsage(response: Response): Promise<CacheProbeUsage> {
  if (!response.body) {
    throw new CacheProbeError('upstream_protocol_error', 'Cache probe SSE body is missing')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let receivedBytes = 0
  let completionUsage: CacheProbeUsage | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        receivedBytes += value.byteLength
        if (receivedBytes > CACHE_PROBE_MAX_SSE_BYTES) {
          throw new CacheProbeError(
            'upstream_protocol_error',
            'Cache probe SSE response exceeded the byte limit',
          )
        }
      }
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
          throw new CacheProbeError(
            'upstream_protocol_error',
            'Cache probe SSE event is invalid JSON',
          )
        }
        if (!event || typeof event.type !== 'string') {
          throw new CacheProbeError('upstream_protocol_error', 'Cache probe SSE event is invalid')
        }
        if (event.type === 'response.completed') {
          completionUsage = parseCacheProbeUsage(event)
          if (!completionUsage) {
            throw new CacheProbeError(
              'cache_usage_missing',
              'Cache probe completion does not expose valid cached-token usage',
            )
          }
        } else if (
          event.type === 'response.failed' ||
          event.type === 'response.incomplete' ||
          event.type === 'error'
        ) {
          throw new CacheProbeError(
            'upstream_protocol_error',
            'Cache probe stream did not complete',
          )
        }
      }

      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (!completionUsage) {
    throw new CacheProbeError(
      'cache_usage_missing',
      'Cache probe stream ended without completion usage',
    )
  }
  return completionUsage
}

async function performRequest(
  fetcher: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<CacheProbeObservation> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Cache probe timed out', 'TimeoutError')),
    timeoutMs,
  )
  const startedAt = performance.now()
  const streaming = body.stream === true

  try {
    let response: Response
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          accept: streaming ? 'text/event-stream' : 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) {
        throw new CacheProbeError('upstream_timeout', 'Cache probe request timed out', 504)
      }
      throw new CacheProbeError('upstream_unavailable', 'Cache probe request failed')
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new CacheProbeError(
        'upstream_http_error',
        `Cache probe returned HTTP ${response.status}`,
      )
    }
    const expectedContentType = streaming ? 'text/event-stream' : 'application/json'
    if (!response.headers.get('content-type')?.includes(expectedContentType)) {
      await response.body?.cancel().catch(() => undefined)
      throw new CacheProbeError(
        'upstream_protocol_error',
        `Cache probe response is not ${streaming ? 'SSE' : 'JSON'}`,
      )
    }

    let usage: CacheProbeUsage
    if (streaming) usage = await parseStreamingUsage(response)
    else {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new CacheProbeError('upstream_protocol_error', 'Cache probe response is invalid JSON')
      }
      const parsed = parseCacheProbeUsage(payload)
      if (!parsed) {
        throw new CacheProbeError(
          'cache_usage_missing',
          'Cache probe response does not expose valid cached-token usage',
        )
      }
      usage = parsed
    }

    return {
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      usage,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function aggregateUsage(first: CacheProbeUsage, second: CacheProbeUsage): CacheProbeUsage {
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
    cacheWriteTokens:
      first.cacheWriteTokens === null && second.cacheWriteTokens === null
        ? null
        : (first.cacheWriteTokens ?? 0) + (second.cacheWriteTokens ?? 0),
  }
}

export async function runCacheProbe(config: CacheProbeRuntimeConfig): Promise<CacheProbeResult> {
  const endpoint = responsesEndpoint(config.baseUrl)
  const fetcher = config.fetcher ?? fetch
  const stream = config.stream ?? true
  const cachePolicy = config.cachePolicy ?? 'declared_implicit'
  const [firstBody, secondBody] = await Promise.all([
    requestBody(config.model, config.promptVersion, false, stream, cachePolicy),
    requestBody(config.model, config.promptVersion, true, stream, cachePolicy),
  ])
  const first = await performRequest(fetcher, endpoint, config.apiKey, firstBody, config.timeoutMs)
  const second = await performRequest(
    fetcher,
    endpoint,
    config.apiKey,
    secondBody,
    config.timeoutMs,
  )
  const result: CacheProbeResult = {
    model: config.model,
    transport: stream ? 'streaming' : 'non_streaming',
    cachePolicy,
    first,
    second,
    aggregateUsage: aggregateUsage(first.usage, second.usage),
    reusedInputTokens: second.usage.cachedInputTokens,
  }

  if (first.usage.inputTokens < 1_024) {
    throw new CacheProbeError(
      'cache_probe_too_short',
      'Cache probe input did not reach the 1024-token eligibility threshold',
      502,
      result,
    )
  }
  if (second.usage.cachedInputTokens < 1) {
    throw new CacheProbeError(
      'cache_probe_miss',
      'The appended eligible request returned zero cached input tokens',
      502,
      result,
    )
  }

  return result
}
