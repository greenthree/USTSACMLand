import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_ABORT_SETTLE_MS = 2_000
const CACHE_PROBE_REPETITIONS = 768
const encoder = new TextEncoder()

export class RelayCompatibilityError extends Error {
  constructor(code, message, status = null) {
    super(message)
    this.name = 'RelayCompatibilityError'
    this.code = code
    this.status = status
  }
}

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function finiteInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function positiveInteger(value, fallback, name, minimum = 1, maximum = 300_000) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RelayCompatibilityError(
      'invalid_configuration',
      `${name} must be an integer between ${minimum} and ${maximum}`,
    )
  }
  return parsed
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RelayCompatibilityError(
      'missing_configuration',
      `Missing required environment variable: ${name}`,
    )
  }
  return value.trim()
}

export function resolveResponsesEndpoint(baseUrl) {
  let url
  try {
    url = new URL(required(baseUrl, 'CHAT_RELAY_BASE_URL'))
  } catch (error) {
    if (error instanceof RelayCompatibilityError) throw error
    throw new RelayCompatibilityError(
      'invalid_configuration',
      'CHAT_RELAY_BASE_URL must be a valid URL',
    )
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new RelayCompatibilityError(
      'invalid_configuration',
      'CHAT_RELAY_BASE_URL must be a credential-free HTTPS URL without query or fragment',
    )
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/responses`
  return url
}

export function parseRelayUsage(value) {
  const event = asRecord(value)
  const response = asRecord(event?.response)
  const usage = asRecord(response?.usage ?? event?.usage)
  const inputTokens = finiteInteger(usage?.input_tokens)
  const outputTokens = finiteInteger(usage?.output_tokens)
  const totalTokens = finiteInteger(usage?.total_tokens)
  if (inputTokens === null || outputTokens === null || totalTokens === null) return null
  if (totalTokens < inputTokens + outputTokens) return null
  return { inputTokens, outputTokens, totalTokens }
}

export function parseRelayCacheUsage(value) {
  const event = asRecord(value)
  const response = asRecord(event?.response)
  const usage = asRecord(response?.usage ?? event?.usage)
  const totals = parseRelayUsage(value)
  const details = asRecord(usage?.input_tokens_details)
  const cachedInputTokens = finiteInteger(details?.cached_tokens)
  if (!totals || cachedInputTokens === null) return null
  return {
    ...totals,
    cachedInputTokens,
    cacheWriteTokens: finiteInteger(details?.cache_write_tokens),
  }
}

function extractVisibleText(value) {
  const response = asRecord(value)
  if (!Array.isArray(response?.output)) return ''
  return response.output
    .flatMap((item) => (Array.isArray(asRecord(item)?.content) ? asRecord(item).content : []))
    .flatMap((part) => {
      const record = asRecord(part)
      if (record?.type === 'output_text' && typeof record.text === 'string') return [record.text]
      if (record?.type === 'refusal' && typeof record.refusal === 'string') return [record.refusal]
      return []
    })
    .join('')
}

function sseData(block) {
  const values = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
  return values.length > 0 ? values.join('\n') : null
}

async function* readSseEvents(response) {
  if (!response.body) {
    throw new RelayCompatibilityError('stream_missing_body', 'Relay stream has no response body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      while (true) {
        const separator = buffer.match(/\r?\n\r?\n/)
        if (!separator || separator.index === undefined) break
        const block = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const data = sseData(block)
        if (!data || data === '[DONE]') continue

        let event
        try {
          event = JSON.parse(data)
        } catch {
          throw new RelayCompatibilityError(
            'stream_invalid_json',
            'Relay stream contains invalid JSON',
          )
        }
        const record = asRecord(event)
        if (!record || typeof record.type !== 'string') {
          throw new RelayCompatibilityError(
            'stream_invalid_event',
            'Relay stream contains an event without a type',
          )
        }
        yield record
      }

      if (done) break
    }
  } finally {
    reader.releaseLock()
  }

  if (buffer.trim()) {
    throw new RelayCompatibilityError(
      'stream_incomplete_frame',
      'Relay stream ended with an incomplete SSE frame',
    )
  }
}

function requestBody({ model, input, stream, maxOutputTokens }) {
  return {
    model,
    instructions:
      'This is an automated protocol compatibility check. Follow the user request concisely.',
    input,
    max_output_tokens: maxOutputTokens,
    prompt_cache_key: createHash('sha256').update(`ustsacmland-relay-cache:${model}`).digest('hex'),
    safety_identifier: createHash('sha256').update('ustsacmland-relay-smoke').digest('hex'),
    store: false,
    stream,
  }
}

function requestHeaders(apiKey) {
  return {
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'x-request-id': randomUUID(),
  }
}

function elapsed(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function createTimedSignal(timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Relay compatibility check timed out', 'TimeoutError')),
    timeoutMs,
  )
  return { controller, clear: () => clearTimeout(timeout) }
}

async function checkedFetch(fetcher, endpoint, apiKey, body, timeoutMs) {
  const timed = createTimedSignal(timeoutMs)
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body: JSON.stringify(body),
      redirect: 'error',
      signal: timed.controller.signal,
    })
    return { response, timed }
  } catch (error) {
    timed.clear()
    if (timed.controller.signal.aborted) {
      throw new RelayCompatibilityError('request_timeout', 'Relay request timed out')
    }
    throw new RelayCompatibilityError('network_error', 'Relay request could not be completed')
  }
}

function assertSuccess(response) {
  if (!response.ok) {
    throw new RelayCompatibilityError(
      'relay_http_error',
      `Relay returned HTTP ${response.status}`,
      response.status,
    )
  }
}

async function checkNonStreaming(options) {
  const startedAt = performance.now()
  const { response, timed } = await checkedFetch(
    options.fetcher,
    options.endpoint,
    options.apiKey,
    requestBody({
      model: options.model,
      input: 'Reply with one short sentence confirming that the compatibility check succeeded.',
      stream: false,
      maxOutputTokens: 96,
    }),
    options.timeoutMs,
  )

  try {
    assertSuccess(response)
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new RelayCompatibilityError(
        'non_stream_invalid_content_type',
        'Relay non-streaming response is not JSON',
      )
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new RelayCompatibilityError(
        'non_stream_invalid_json',
        'Relay non-streaming response contains invalid JSON',
      )
    }
    const record = asRecord(payload)
    const usage = parseRelayUsage(record)
    const text = extractVisibleText(record)
    if (!record || typeof record.model !== 'string' || !record.model.trim()) {
      throw new RelayCompatibilityError(
        'non_stream_missing_model',
        'Relay non-streaming response does not identify the model',
      )
    }
    if (!text.trim()) {
      throw new RelayCompatibilityError(
        'non_stream_missing_text',
        'Relay non-streaming response contains no visible text',
      )
    }
    if (!usage) {
      throw new RelayCompatibilityError(
        'non_stream_missing_usage',
        'Relay non-streaming response contains no valid token usage',
      )
    }
    return {
      durationMs: elapsed(startedAt),
      actualModel: record.model.trim(),
      visibleCharacters: Array.from(text).length,
      usage,
    }
  } finally {
    timed.clear()
  }
}

async function checkStreaming(options) {
  const startedAt = performance.now()
  const { response, timed } = await checkedFetch(
    options.fetcher,
    options.endpoint,
    options.apiKey,
    requestBody({
      model: options.model,
      input: 'Reply with two short sentences about learning algorithms step by step.',
      stream: true,
      maxOutputTokens: 192,
    }),
    options.timeoutMs,
  )

  try {
    assertSuccess(response)
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new RelayCompatibilityError(
        'stream_invalid_content_type',
        'Relay streaming response is not text/event-stream',
      )
    }

    const eventTypes = []
    let deltaCount = 0
    let visibleCharacters = 0
    let firstDeltaMs = null
    let terminalUsage = null
    let terminalType = null
    let actualModel = null

    for await (const event of readSseEvents(response)) {
      eventTypes.push(event.type)
      if (event.type === 'response.created') {
        const createdResponse = asRecord(event.response)
        if (typeof createdResponse?.model === 'string') actualModel = createdResponse.model
      }
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        if (typeof event.delta !== 'string') {
          throw new RelayCompatibilityError(
            'stream_invalid_delta',
            'Relay text delta is not a string',
          )
        }
        if (firstDeltaMs === null) firstDeltaMs = elapsed(startedAt)
        deltaCount += 1
        visibleCharacters += Array.from(event.delta).length
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        terminalType = event.type
        terminalUsage = parseRelayUsage(event)
        const terminalResponse = asRecord(event.response)
        if (typeof terminalResponse?.model === 'string') actualModel = terminalResponse.model
      }
      if (event.type === 'response.failed' || event.type === 'error') {
        throw new RelayCompatibilityError('stream_failed_event', 'Relay emitted a failure event')
      }
    }

    if (!eventTypes.includes('response.created')) {
      throw new RelayCompatibilityError(
        'stream_missing_created',
        'Relay stream did not emit response.created',
      )
    }
    if (deltaCount < 1 || visibleCharacters < 1 || firstDeltaMs === null) {
      throw new RelayCompatibilityError(
        'stream_missing_delta',
        'Relay stream did not emit visible text deltas',
      )
    }
    if (terminalType !== 'response.completed') {
      throw new RelayCompatibilityError(
        'stream_not_completed',
        'Relay stream did not finish with response.completed',
      )
    }
    if (!terminalUsage) {
      throw new RelayCompatibilityError(
        'stream_missing_usage',
        'Relay completion event contains no valid token usage',
      )
    }
    if (!actualModel?.trim()) {
      throw new RelayCompatibilityError(
        'stream_missing_model',
        'Relay stream does not identify the model',
      )
    }

    return {
      durationMs: elapsed(startedAt),
      firstDeltaMs,
      actualModel: actualModel.trim(),
      deltaCount,
      visibleCharacters,
      terminalType,
      usage: terminalUsage,
      eventTypes: [...new Set(eventTypes)],
    }
  } finally {
    timed.clear()
  }
}

function cacheProbeInput() {
  const stablePrefix = Array.from(
    { length: CACHE_PROBE_REPETITIONS },
    () => 'cache probe validation',
  ).join(' ')
  return `${stablePrefix}\nReply only with OK.`
}

async function performCacheProbeRequest(options, input) {
  const startedAt = performance.now()
  const { response, timed } = await checkedFetch(
    options.fetcher,
    options.endpoint,
    options.apiKey,
    requestBody({
      model: options.model,
      input,
      stream: false,
      maxOutputTokens: 16,
    }),
    options.timeoutMs,
  )

  try {
    assertSuccess(response)
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new RelayCompatibilityError(
        'cache_probe_invalid_content_type',
        'Relay cache probe response is not JSON',
      )
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new RelayCompatibilityError(
        'cache_probe_invalid_json',
        'Relay cache probe response contains invalid JSON',
      )
    }
    const usage = parseRelayCacheUsage(payload)
    if (!usage) {
      throw new RelayCompatibilityError(
        'cache_probe_missing_usage',
        'Relay cache probe does not expose input_tokens_details.cached_tokens',
      )
    }
    return { durationMs: elapsed(startedAt), usage }
  } finally {
    timed.clear()
  }
}

async function checkPromptCaching(options) {
  const input = cacheProbeInput()
  const first = await performCacheProbeRequest(options, input)
  if (first.usage.inputTokens < 1_024) {
    throw new RelayCompatibilityError(
      'cache_probe_too_short',
      'Relay counted fewer than 1024 input tokens for the cache probe',
    )
  }
  const second = await performCacheProbeRequest(options, input)
  if (second.usage.cachedInputTokens < 1) {
    throw new RelayCompatibilityError(
      'cache_probe_miss',
      'Relay returned zero cached input tokens for the repeated long-prefix request',
    )
  }
  return {
    first,
    second,
    reusedInputTokens: second.usage.cachedInputTokens,
  }
}

async function waitForAbortSettlement(reader, settleMs) {
  const startedAt = performance.now()
  let timeout
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new RelayCompatibilityError(
          'abort_did_not_settle',
          `Relay stream did not settle within ${settleMs} ms after Abort`,
        ),
      )
    }, settleMs)
  })
  const drain = (async () => {
    while (true) {
      try {
        const { done } = await reader.read()
        if (done) return { result: 'closed', settledMs: elapsed(startedAt) }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return { result: 'aborted', settledMs: elapsed(startedAt) }
        }
        throw new RelayCompatibilityError(
          'abort_unexpected_error',
          'Relay stream failed unexpectedly after Abort',
        )
      }
    }
  })()
  try {
    return await Promise.race([drain, deadline])
  } finally {
    clearTimeout(timeout)
  }
}

async function checkAbort(options) {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Abort smoke timed out', 'TimeoutError')),
    options.timeoutMs,
  )
  let response
  try {
    response = await options.fetcher(options.endpoint, {
      method: 'POST',
      headers: requestHeaders(options.apiKey),
      body: JSON.stringify(
        requestBody({
          model: options.model,
          input:
            'Write a long numbered list with one hundred brief algorithm learning tips, one item per line.',
          stream: true,
          maxOutputTokens: 2_048,
        }),
      ),
      redirect: 'error',
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timeout)
    throw new RelayCompatibilityError('abort_start_failed', 'Abort smoke could not start')
  }

  let reader = null
  const decoder = new TextDecoder()
  let buffer = ''
  let deltaObserved = false
  let deltaMs = null

  try {
    assertSuccess(response)
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
      throw new RelayCompatibilityError(
        'abort_invalid_stream',
        'Abort smoke did not receive an SSE response',
      )
    }
    reader = response.body.getReader()

    while (!deltaObserved) {
      const { done, value } = await reader.read()
      if (done) {
        throw new RelayCompatibilityError(
          'abort_stream_ended_early',
          'Relay stream ended before the Abort checkpoint',
        )
      }
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const separator = buffer.match(/\r?\n\r?\n/)
        if (!separator || separator.index === undefined) break
        const block = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const data = sseData(block)
        if (!data || data === '[DONE]') continue
        let event
        try {
          event = asRecord(JSON.parse(data))
        } catch {
          throw new RelayCompatibilityError(
            'abort_invalid_event',
            'Abort smoke received invalid SSE JSON',
          )
        }
        if (event?.type === 'response.completed' || event?.type === 'response.incomplete') {
          throw new RelayCompatibilityError(
            'abort_completed_before_checkpoint',
            'Relay completed before an in-flight Abort could be tested',
          )
        }
        if (
          (event?.type === 'response.output_text.delta' ||
            event?.type === 'response.refusal.delta') &&
          typeof event.delta === 'string' &&
          event.delta.length > 0
        ) {
          deltaObserved = true
          deltaMs = elapsed(startedAt)
          controller.abort(new DOMException('Compatibility abort checkpoint', 'AbortError'))
          break
        }
      }
    }

    const settlement = await waitForAbortSettlement(reader, options.abortSettleMs)
    return {
      firstDeltaMs: deltaMs,
      settleResult: settlement.result,
      settledMs: settlement.settledMs,
    }
  } finally {
    clearTimeout(timeout)
    controller.abort()
    if (reader) {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    } else {
      await response.body?.cancel().catch(() => undefined)
    }
  }
}

function hostDigest(endpoint) {
  return createHash('sha256').update(endpoint.host).digest('hex')
}

function publicError(error) {
  if (error instanceof RelayCompatibilityError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return {
    code: 'unexpected_error',
    message: 'Unexpected relay compatibility failure',
    status: null,
  }
}

async function writeReport(path, report) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runRelayCompatibility(options) {
  const endpoint = resolveResponsesEndpoint(options.baseUrl)
  const apiKey = required(options.apiKey, 'CHAT_RELAY_API_KEY')
  const model = required(options.model, 'CHAT_RELAY_MODEL')
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    'WEBCHAT_RELAY_TIMEOUT_MS',
    5_000,
  )
  const abortSettleMs = positiveInteger(
    options.abortSettleMs,
    DEFAULT_ABORT_SETTLE_MS,
    'WEBCHAT_RELAY_ABORT_SETTLE_MS',
    250,
    10_000,
  )
  const report = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    status: 'running',
    relay: {
      hostSha256: hostDigest(endpoint),
      path: endpoint.pathname,
      requestedModel: model,
    },
    checks: {},
  }

  try {
    const shared = {
      endpoint,
      apiKey,
      model,
      timeoutMs,
      abortSettleMs,
      fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis),
    }
    report.checks.nonStreaming = await checkNonStreaming(shared)
    if (options.checkCache !== false) report.checks.promptCaching = await checkPromptCaching(shared)
    report.checks.streaming = await checkStreaming(shared)
    if (options.checkAbort !== false) report.checks.abort = await checkAbort(shared)
    report.status = 'passed'
    await writeReport(options.reportPath, report)
    return report
  } catch (error) {
    report.status = 'failed'
    report.error = publicError(error)
    await writeReport(options.reportPath, report)
    throw error
  }
}

function booleanEnv(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  return value.trim().toLowerCase() === 'true'
}

async function main() {
  const reportPath = process.env.WEBCHAT_RELAY_REPORT_PATH?.trim() || null
  try {
    const report = await runRelayCompatibility({
      baseUrl: process.env.CHAT_RELAY_BASE_URL,
      apiKey: process.env.CHAT_RELAY_API_KEY,
      model: process.env.CHAT_RELAY_MODEL,
      timeoutMs: process.env.WEBCHAT_RELAY_TIMEOUT_MS,
      abortSettleMs: process.env.WEBCHAT_RELAY_ABORT_SETTLE_MS,
      checkAbort: booleanEnv(process.env.WEBCHAT_RELAY_ABORT_CHECK, true),
      checkCache: booleanEnv(process.env.WEBCHAT_RELAY_CACHE_CHECK, true),
      reportPath,
    })
    console.log(
      `WebChat relay compatibility passed for ${report.relay.requestedModel}: non-stream, typed SSE, Usage${report.checks.promptCaching ? ', Prompt Caching' : ''}${report.checks.abort ? ', and Abort' : ''}.`,
    )
  } catch (error) {
    const safe = publicError(error)
    console.error(`WebChat relay compatibility failed [${safe.code}]: ${safe.message}`)
    process.exitCode = 1
  }
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
