import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TIMEOUT_MS = 300_000

export class ProductionCacheProbeError extends Error {
  constructor(code, message, status = null, report = null) {
    super(message)
    this.name = 'ProductionCacheProbeError'
    this.code = code
    this.status = status
    this.report = report
  }
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProductionCacheProbeError(
      'missing_configuration',
      `Missing required environment variable: ${name}`,
    )
  }
  return value.trim()
}

function projectRef(value) {
  const ref = required(value, 'SUPABASE_PROJECT_REF')
  if (!/^[a-z]{20}$/.test(ref)) {
    throw new ProductionCacheProbeError(
      'invalid_configuration',
      'SUPABASE_PROJECT_REF must be a 20-letter project reference',
    )
  }
  return ref
}

function timeout(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 10_000 || parsed > 600_000) {
    throw new ProductionCacheProbeError(
      'invalid_configuration',
      'WEBCHAT_CACHE_PROBE_CLIENT_TIMEOUT_MS must be between 10000 and 600000',
    )
  }
  return parsed
}

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProductionCacheProbeError('invalid_response', `Probe returned invalid ${name}`)
  }
  return value
}

function timestamp(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ProductionCacheProbeError('invalid_response', `Probe returned invalid ${name}`)
  }
  return value
}

function usage(value) {
  const candidate = asRecord(value)
  if (!candidate) throw new ProductionCacheProbeError('invalid_response', 'Probe usage is missing')
  const cacheWriteTokens =
    candidate.cacheWriteTokens === null
      ? null
      : integer(candidate.cacheWriteTokens, 'cache-write tokens')
  return {
    inputTokens: integer(candidate.inputTokens, 'input tokens'),
    outputTokens: integer(candidate.outputTokens, 'output tokens'),
    totalTokens: integer(candidate.totalTokens, 'total tokens'),
    cachedInputTokens: integer(candidate.cachedInputTokens, 'cached input tokens'),
    cacheWriteTokens,
  }
}

function observation(value) {
  const candidate = asRecord(value)
  if (!candidate) {
    throw new ProductionCacheProbeError('invalid_response', 'Probe observation is missing')
  }
  return {
    durationMs: integer(candidate.durationMs, 'duration'),
    usage: usage(candidate.usage),
  }
}

function sanitizeProbe(value) {
  const candidate = asRecord(value)
  if (!candidate || typeof candidate.model !== 'string' || !candidate.model.trim()) {
    throw new ProductionCacheProbeError('invalid_response', 'Probe model is missing')
  }
  return {
    model: candidate.model.trim(),
    transport:
      candidate.transport === 'streaming' || candidate.transport === 'non_streaming'
        ? candidate.transport
        : (() => {
            throw new ProductionCacheProbeError('invalid_response', 'Probe transport is missing')
          })(),
    first: observation(candidate.first),
    second: observation(candidate.second),
    aggregateUsage: usage(candidate.aggregateUsage),
    reusedInputTokens: integer(candidate.reusedInputTokens, 'reused input tokens'),
  }
}

function sanitizeSuccess(payload) {
  const candidate = asRecord(payload)
  if (!candidate || candidate.ok !== true) {
    throw new ProductionCacheProbeError('invalid_response', 'Probe success payload is invalid')
  }
  const probe = sanitizeProbe(candidate.probe)
  if (probe.first.usage.inputTokens < 1_024) {
    throw new ProductionCacheProbeError(
      'cache_probe_too_short',
      'The first probe request was not cache eligible',
    )
  }
  if (probe.second.usage.cachedInputTokens < 1 || probe.reusedInputTokens < 1) {
    throw new ProductionCacheProbeError(
      'cache_probe_miss',
      'The repeated production request returned zero cached input tokens',
    )
  }
  return {
    ok: true,
    checkedAt: timestamp(candidate.checkedAt, 'check timestamp'),
    usageDate:
      typeof candidate.usageDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.usageDate)
        ? candidate.usageDate
        : (() => {
            throw new ProductionCacheProbeError('invalid_response', 'Probe usage date is invalid')
          })(),
    remainingGlobalRequests: integer(
      candidate.remainingGlobalRequests,
      'remaining global requests',
    ),
    remainingGlobalTokens: integer(candidate.remainingGlobalTokens, 'remaining global tokens'),
    chargedTokens: integer(candidate.chargedTokens, 'charged tokens'),
    probe,
  }
}

function sanitizeFailure(payload, status) {
  const candidate = asRecord(payload)
  const error = asRecord(candidate?.error)
  const code = typeof error?.code === 'string' ? error.code : 'probe_http_error'
  const message =
    typeof error?.message === 'string' ? error.message : `Probe returned HTTP ${status}`
  const retryAfterSeconds =
    error?.retryAfterSeconds === null || error?.retryAfterSeconds === undefined
      ? null
      : integer(error.retryAfterSeconds, 'retry delay')
  return {
    ok: false,
    checkedAt: new Date().toISOString(),
    status,
    error: { code, message, retryAfterSeconds },
    ...(candidate?.probe ? { probe: sanitizeProbe(candidate.probe) } : {}),
  }
}

async function writeReport(path, report) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export async function runProductionCacheProbe(options) {
  const ref = projectRef(options.projectRef)
  const serviceRoleKey = required(options.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY')
  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException('Production cache probe timed out', 'TimeoutError')),
    timeout(options.timeoutMs),
  )
  let report

  try {
    let response
    try {
      response = await fetcher(`https://${ref}.supabase.co/functions/v1/webchat-cache-probe`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      throw new ProductionCacheProbeError(
        controller.signal.aborted ? 'request_timeout' : 'network_error',
        controller.signal.aborted
          ? 'Production cache probe timed out'
          : 'Production cache probe could not be reached',
      )
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new ProductionCacheProbeError(
        'invalid_response',
        'Production cache probe did not return JSON',
        response.status,
      )
    }

    if (!response.ok) {
      report = sanitizeFailure(payload, response.status)
      throw new ProductionCacheProbeError(
        report.error.code,
        report.error.message,
        response.status,
        report,
      )
    }

    report = sanitizeSuccess(payload)
    await writeReport(options.reportPath, report)
    return report
  } catch (error) {
    const probeError =
      error instanceof ProductionCacheProbeError
        ? error
        : new ProductionCacheProbeError('unexpected_error', 'Production cache probe failed')
    report = probeError.report ?? {
      ok: false,
      checkedAt: new Date().toISOString(),
      status: probeError.status,
      error: { code: probeError.code, message: probeError.message, retryAfterSeconds: null },
    }
    await writeReport(options.reportPath, report)
    throw probeError
  } finally {
    clearTimeout(timeoutId)
  }
}

async function main() {
  const report = await runProductionCacheProbe({
    projectRef: process.env.SUPABASE_PROJECT_REF,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    timeoutMs: process.env.WEBCHAT_CACHE_PROBE_CLIENT_TIMEOUT_MS,
    reportPath:
      process.env.WEBCHAT_CACHE_PROBE_REPORT_PATH?.trim() ||
      'artifacts/webchat-production-cache-probe.json',
  })
  console.log(
    `Verified ${report.probe.transport} production prompt caching for ${report.probe.model}: ${report.probe.reusedInputTokens} cached input tokens on request two.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
