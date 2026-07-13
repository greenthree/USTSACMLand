import { fetchJson, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface LuoguRecord {
  problem?: {
    pid?: unknown
  } | null
}

interface LuoguRecordListResponse {
  currentData?: {
    records?: {
      result?: unknown
      count?: unknown
    } | null
  } | null
}

export interface LuoguRecordPage {
  problemIds: string[]
  recordCount: number
  totalRecords: number | null
}

export interface LuoguTransport {
  fetchRecordPage(accountId: string, page: number, signal?: AbortSignal): Promise<unknown>
}

export interface LuoguAdapterOptions {
  transport?: LuoguTransport | null
  maxPages?: number
  pageDelayMs?: number
}

const ORIGIN = 'https://www.luogu.com.cn'
const DEFAULT_MAX_PAGES = 100
const MAX_MAX_PAGES = 1_000
const DEFAULT_PAGE_DELAY_MS = 300
const COUNTED_PROBLEM_PID = /^[PB]/i
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseOptionalTotal(records: Record<string, unknown>): number | null {
  if (!Object.hasOwn(records, 'count')) return null
  const count = records.count
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new HttpError('Luogu record total is invalid', 'schema_changed', false)
  }
  return count
}

export function parseLuoguRecordPage(payload: unknown): LuoguRecordPage {
  if (!isRecord(payload)) {
    throw new HttpError('Luogu record response is not an object', 'schema_changed', false)
  }

  const response = payload as LuoguRecordListResponse
  if (!isRecord(response.currentData)) {
    throw new HttpError('Luogu currentData is missing', 'schema_changed', false)
  }
  if (!isRecord(response.currentData.records)) {
    throw new HttpError('Luogu records object is missing', 'schema_changed', false)
  }

  const records = response.currentData.records as Record<string, unknown>
  if (!Array.isArray(records.result)) {
    throw new HttpError('Luogu record result is not an array', 'schema_changed', false)
  }

  const problemIds = records.result.map((value, index) => {
    if (!isRecord(value)) {
      throw new HttpError(`Luogu record ${index} is not an object`, 'schema_changed', false)
    }
    const record = value as LuoguRecord
    if (!isRecord(record.problem)) {
      throw new HttpError(`Luogu record ${index} problem is missing`, 'schema_changed', false)
    }
    const pid = record.problem.pid
    if (typeof pid !== 'string' || pid.length === 0 || pid.length > 100 || pid.trim() !== pid) {
      throw new HttpError(`Luogu record ${index} problem PID is invalid`, 'schema_changed', false)
    }
    return pid
  })

  return {
    problemIds,
    recordCount: records.result.length,
    totalRecords: parseOptionalTotal(records),
  }
}

function createAuthenticatedTransport(cookie: string, csrfToken: string): LuoguTransport {
  return {
    fetchRecordPage(accountId, page, signal) {
      const url = new URL('/record/list', ORIGIN)
      url.searchParams.set('user', accountId)
      url.searchParams.set('page', String(page))
      url.searchParams.set('status', '12')
      url.searchParams.set('_contentOnly', '1')

      return fetchJson<unknown>(url, {
        signal,
        timeoutMs: 15_000,
        retries: 2,
        retryBaseMs: 750,
        headers: {
          accept: 'application/json, text/plain, */*',
          cookie,
          referer: `${ORIGIN}/record/list?user=${encodeURIComponent(accountId)}`,
          'user-agent': BROWSER_USER_AGENT,
          'x-csrf-token': csrfToken,
          'x-requested-with': 'XMLHttpRequest',
        },
      })
    },
  }
}

function environmentValue(name: string): string | undefined {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

function environmentTransport(): LuoguTransport | null {
  const cookie = environmentValue('LUOGU_COOKIE')?.trim()
  const csrfToken = environmentValue('LUOGU_CSRF_TOKEN')?.trim()
  if (!cookie || !csrfToken) return null
  return createAuthenticatedTransport(cookie, csrfToken)
}

function resolveMaxPages(configured: number | undefined, useEnvironment: boolean): number {
  const raw =
    configured ??
    (useEnvironment ? environmentValue('LUOGU_MAX_PAGES') : undefined) ??
    DEFAULT_MAX_PAGES
  const maxPages = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_MAX_PAGES) {
    throw new HttpError(
      `LUOGU_MAX_PAGES must be an integer between 1 and ${MAX_MAX_PAGES}`,
      'not_configured',
      false,
    )
  }
  return maxPages
}

function waitForNextPage(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeLuoguError(error: unknown): ReturnType<typeof toAdapterHttpError> {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return {
      code: 'auth_expired',
      message: 'Luogu authentication credentials are invalid or expired',
      retryable: false,
      details: { httpStatus: error.status },
    }
  }
  if (error instanceof HttpError && error.status === 429) {
    return {
      code: 'rate_limited',
      message: 'Luogu rate limit was reached',
      retryable: true,
      details: { httpStatus: 429 },
    }
  }
  return toAdapterHttpError(error)
}

async function countAcceptedProblems(
  transport: LuoguTransport,
  accountId: string,
  maxPages: number,
  pageDelayMs: number,
  signal?: AbortSignal,
): Promise<{ solvedCount: number; pagesRead: number; recordsRead: number }> {
  const countedProblemIds = new Set<string>()
  let pagesRead = 0
  let recordsRead = 0
  let expectedTotal: number | null = null
  let complete = false

  for (let page = 1; page <= maxPages; page += 1) {
    const recordPage = parseLuoguRecordPage(
      await transport.fetchRecordPage(accountId, page, signal),
    )
    pagesRead += 1

    if (recordPage.totalRecords !== null) {
      if (expectedTotal !== null && recordPage.totalRecords !== expectedTotal) {
        throw new HttpError('Luogu record total changed between pages', 'schema_changed', false)
      }
      expectedTotal = recordPage.totalRecords
    }

    recordsRead += recordPage.recordCount
    if (expectedTotal !== null && recordsRead > expectedTotal) {
      throw new HttpError('Luogu returned more records than its total', 'schema_changed', false)
    }
    for (const problemId of recordPage.problemIds) {
      if (COUNTED_PROBLEM_PID.test(problemId)) countedProblemIds.add(problemId.toUpperCase())
    }

    if (recordPage.recordCount === 0) {
      if (expectedTotal !== null && recordsRead < expectedTotal) {
        throw new HttpError(
          'Luogu record list ended before its declared total',
          'schema_changed',
          false,
        )
      }
      complete = true
      break
    }
    if (expectedTotal !== null && recordsRead === expectedTotal) {
      complete = true
      break
    }

    if (page < maxPages) await waitForNextPage(pageDelayMs, signal)
  }

  if (!complete) {
    throw new HttpError(
      `Luogu record history exceeded the ${maxPages}-page safety limit`,
      'source_unavailable',
      false,
    )
  }

  return { solvedCount: countedProblemIds.size, pagesRead, recordsRead }
}

export function createLuoguAdapter(options: LuoguAdapterOptions = {}): PlatformAdapter {
  return {
    platform: 'luogu',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      if (!/^\d{1,20}$/.test(accountId)) {
        return failure('luogu', accountId, 'invalid_account', 'Invalid Luogu UID format', false)
      }

      const transport = options.transport === undefined ? environmentTransport() : options.transport
      if (!transport) {
        return failure(
          'luogu',
          accountId,
          'not_configured',
          'Luogu authentication is not configured',
          false,
          { requiredSecrets: ['LUOGU_COOKIE', 'LUOGU_CSRF_TOKEN'] },
        )
      }

      try {
        const maxPages = resolveMaxPages(options.maxPages, options.transport === undefined)
        const pageDelayMs =
          options.pageDelayMs ?? (options.transport === undefined ? DEFAULT_PAGE_DELAY_MS : 0)
        const metrics = await countAcceptedProblems(
          transport,
          accountId,
          maxPages,
          pageDelayMs,
          context?.signal,
        )
        return success(
          'luogu',
          accountId,
          { currentRating: null, maxRating: null, solvedCount: metrics.solvedCount },
          {
            sourceUpdatedAt: null,
            sourceVersion: 'luogu-authenticated-record-list-pb-v1',
            details: {
              provider: 'authenticated_record_list',
              statistic: 'unique currentData.records.result[].problem.pid',
              pidPrefixes: ['P', 'B'],
              pagesRead: metrics.pagesRead,
              recordsRead: metrics.recordsRead,
            },
          },
        )
      } catch (error) {
        const normalized = normalizeLuoguError(error)
        return failure(
          'luogu',
          accountId,
          normalized.code,
          normalized.message,
          normalized.retryable,
          normalized.details,
        )
      }
    },
  }
}

export const luoguAdapter = createLuoguAdapter()
