import { promptCacheKey, responsesEndpoint } from '../webchat/upstream.ts'

const CACHE_PROBE_REPETITIONS = 768
const CACHE_PROBE_VERSION = 'cache-probe-v1'
const CACHE_PROBE_MAX_OUTPUT_TOKENS = 16
const encoder = new TextEncoder()

export interface CacheProbeRuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  fetcher?: typeof fetch
}

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

async function requestBody(model: string): Promise<Record<string, unknown>> {
  return {
    model,
    instructions:
      'This is an automated prompt-cache verification request. Follow the final instruction exactly.',
    input: probeInput(),
    max_output_tokens: CACHE_PROBE_MAX_OUTPUT_TOKENS,
    prompt_cache_key: await promptCacheKey(model, CACHE_PROBE_VERSION),
    store: false,
    stream: false,
  }
}

export async function cacheProbeReservationTokens(model: string): Promise<number> {
  const serialized = JSON.stringify(await requestBody(model))
  // A token must consume at least one encoded byte. Reserve two complete
  // requests, their maximum outputs, and provider framing that is not visible
  // in the JSON payload so an honest Usage response cannot exceed the claim.
  const perRequest = encoder.encode(serialized).byteLength + CACHE_PROBE_MAX_OUTPUT_TOKENS + 1_024
  const reservation = perRequest * 2
  if (!Number.isSafeInteger(reservation) || reservation < 1_024 || reservation > 1_000_000) {
    throw new CacheProbeError('reservation_invalid', 'Cache probe reservation is invalid', 500)
  }
  return reservation
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

  try {
    let response: Response
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
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
    if (!response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel().catch(() => undefined)
      throw new CacheProbeError('upstream_protocol_error', 'Cache probe response is not JSON')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new CacheProbeError('upstream_protocol_error', 'Cache probe response is invalid JSON')
    }
    const usage = parseCacheProbeUsage(payload)
    if (!usage) {
      throw new CacheProbeError(
        'cache_usage_missing',
        'Cache probe response does not expose valid cached-token usage',
      )
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
  const body = await requestBody(config.model)
  const first = await performRequest(fetcher, endpoint, config.apiKey, body, config.timeoutMs)
  const second = await performRequest(fetcher, endpoint, config.apiKey, body, config.timeoutMs)
  const result: CacheProbeResult = {
    model: config.model,
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
      'The repeated eligible request returned zero cached input tokens',
      502,
      result,
    )
  }

  return result
}
