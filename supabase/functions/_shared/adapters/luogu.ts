import { fetchTextWithRetry, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface LuoguRecord {
  id?: unknown
  submitTime?: unknown
  problem?: {
    pid?: unknown
  } | null
}

interface LuoguRecordListResponse {
  currentData?: {
    errorCode?: unknown
    records?: {
      result?: unknown
      count?: unknown
    } | null
  } | null
}

export interface LuoguAcceptedRecord {
  id: string
  submitTime: number
  problemId: string
}

export interface LuoguRecordPage {
  records: LuoguAcceptedRecord[]
  recordCount: number
  totalRecords: number | null
}

export interface LuoguSyncState {
  accountId: string
  boundaryRecordId: string | null
  boundarySubmitTime: number | null
  totalRecords: number | null
  problemIds: string[]
  lastFullSyncAt: string
}

export interface LuoguTransport {
  fetchRecordPage(accountId: string, page: number, signal?: AbortSignal): Promise<unknown>
}

export interface LuoguAdapterOptions {
  transport?: LuoguTransport | null
  maxPages?: number
  pageDelayMs?: number
  now?: () => Date
}

interface ScanResult {
  records: LuoguAcceptedRecord[]
  pagesRead: number
  recordsRead: number
  totalRecords: number | null
  boundaryIndex: number | null
  complete: boolean
}

interface SyncMetrics {
  solvedCount: number
  state: LuoguSyncState
  pagesRead: number
  recordsRead: number
  newRecords: number
  newProblems: number
  syncMode: 'full' | 'incremental' | 'rebuild'
  fallbackReason: string | null
}

const ORIGIN = 'https://www.luogu.com.cn'
const DEFAULT_MAX_PAGES = 100
const MAX_MAX_PAGES = 1_000
const DEFAULT_PAGE_DELAY_MS = 300
const FULL_SYNC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_STATE_PROBLEMS = 100_000
const COUNTED_PROBLEM_PID = /^[PB]/i
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

function challengePage(body: string): boolean {
  return (
    body.includes('challenge-platform') ||
    body.includes('aliyun_waf_') ||
    body.includes('__shield') ||
    /<title>\s*Just a moment/i.test(body)
  )
}

export function parseLuoguJsonResponse(
  text: string,
  status: number,
  contentType: string | null,
): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (challengePage(text)) {
      throw new HttpError(
        'Luogu returned an anti-bot challenge page',
        'source_unavailable',
        true,
        status,
      )
    }
    if (/^\s*</.test(text) || contentType?.includes('text/html')) {
      throw new HttpError(
        'Luogu authentication credentials are invalid or expired',
        'auth_expired',
        false,
        status,
      )
    }
    throw new HttpError('Upstream returned invalid JSON', 'schema_changed', false, status)
  }
}

async function fetchAuthenticatedJson(
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const { response, text } = await fetchTextWithRetry(url, {
    signal,
    timeoutMs: 15_000,
    retries: 2,
    retryBaseMs: 750,
    headers,
  })
  return parseLuoguJsonResponse(text, response.status, response.headers.get('content-type'))
}

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

function parseRecordId(value: unknown, index: number): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string' && /^\d{1,30}$/.test(value)) return value
  throw new HttpError(`Luogu record ${index} ID is invalid`, 'schema_changed', false)
}

export function parseLuoguRecordPage(payload: unknown): LuoguRecordPage {
  if (!isRecord(payload)) {
    throw new HttpError('Luogu record response is not an object', 'schema_changed', false)
  }

  const response = payload as LuoguRecordListResponse
  if (!isRecord(response.currentData)) {
    throw new HttpError('Luogu currentData is missing', 'schema_changed', false)
  }
  if (response.currentData.errorCode === 404) {
    throw new HttpError('Luogu user was not found', 'not_found', false, 404)
  }
  if (!isRecord(response.currentData.records)) {
    throw new HttpError('Luogu records object is missing', 'schema_changed', false)
  }

  const records = response.currentData.records as Record<string, unknown>
  if (!Array.isArray(records.result)) {
    throw new HttpError('Luogu record result is not an array', 'schema_changed', false)
  }

  const parsedRecords = records.result.map((value, index) => {
    if (!isRecord(value)) {
      throw new HttpError(`Luogu record ${index} is not an object`, 'schema_changed', false)
    }
    const record = value as LuoguRecord
    if (!isRecord(record.problem)) {
      throw new HttpError(`Luogu record ${index} problem is missing`, 'schema_changed', false)
    }
    const problemId = record.problem.pid
    if (
      typeof problemId !== 'string' ||
      problemId.length === 0 ||
      problemId.length > 100 ||
      problemId.trim() !== problemId
    ) {
      throw new HttpError(`Luogu record ${index} problem PID is invalid`, 'schema_changed', false)
    }
    if (
      typeof record.submitTime !== 'number' ||
      !Number.isSafeInteger(record.submitTime) ||
      record.submitTime < 0
    ) {
      throw new HttpError(`Luogu record ${index} submit time is invalid`, 'schema_changed', false)
    }
    return {
      id: parseRecordId(record.id, index),
      submitTime: record.submitTime,
      problemId,
    }
  })

  return {
    records: parsedRecords,
    recordCount: parsedRecords.length,
    totalRecords: parseOptionalTotal(records),
  }
}

function createAuthenticatedTransport(cookie: string, csrfToken: string): LuoguTransport {
  const headers = {
    accept: 'application/json, text/plain, */*',
    cookie,
    'user-agent': BROWSER_USER_AGENT,
    'x-csrf-token': csrfToken,
    'x-requested-with': 'XMLHttpRequest',
  }
  return {
    fetchRecordPage(accountId, page, signal) {
      const url = new URL('/record/list', ORIGIN)
      url.searchParams.set('user', accountId)
      url.searchParams.set('page', String(page))
      url.searchParams.set('status', '12')
      url.searchParams.set('_contentOnly', '1')

      return fetchAuthenticatedJson(
        url,
        {
          ...headers,
          referer: `${ORIGIN}/record/list?user=${encodeURIComponent(accountId)}`,
        },
        signal,
      )
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

function parseSyncState(value: unknown, accountId: string): LuoguSyncState | null {
  if (!isRecord(value) || value.accountId !== accountId) return null
  const boundaryRecordId = value.boundaryRecordId
  const boundarySubmitTime = value.boundarySubmitTime
  if (!(
    (boundaryRecordId === null && boundarySubmitTime === null) ||
    (typeof boundaryRecordId === 'string' &&
      /^\d{1,30}$/.test(boundaryRecordId) &&
      typeof boundarySubmitTime === 'number' &&
      Number.isSafeInteger(boundarySubmitTime) &&
      boundarySubmitTime >= 0)
  )) {
    return null
  }
  if (
    !(
      value.totalRecords === null ||
      (typeof value.totalRecords === 'number' &&
        Number.isSafeInteger(value.totalRecords) &&
        value.totalRecords >= 0)
    ) ||
    !Array.isArray(value.problemIds) ||
    value.problemIds.length > MAX_STATE_PROBLEMS ||
    typeof value.lastFullSyncAt !== 'string' ||
    !Number.isFinite(Date.parse(value.lastFullSyncAt))
  ) {
    return null
  }

  const problemIds = new Set<string>()
  for (const problemId of value.problemIds) {
    if (
      typeof problemId !== 'string' ||
      problemId.length === 0 ||
      problemId.length > 100 ||
      problemId.trim() !== problemId ||
      !COUNTED_PROBLEM_PID.test(problemId)
    ) {
      return null
    }
    problemIds.add(problemId.toUpperCase())
  }

  return {
    accountId,
    boundaryRecordId,
    boundarySubmitTime,
    totalRecords: value.totalRecords as number | null,
    problemIds: [...problemIds].sort(),
    lastFullSyncAt: value.lastFullSyncAt,
  }
}

async function scanRecordHistory(
  transport: LuoguTransport,
  accountId: string,
  boundaryRecordId: string | null,
  maxPages: number,
  pageDelayMs: number,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const records: LuoguAcceptedRecord[] = []
  const seenRecordIds = new Set<string>()
  let pagesRead = 0
  let recordsRead = 0
  let expectedTotal: number | null = null
  let boundaryIndex: number | null = null
  let complete = false
  let previousSubmitTime = Number.POSITIVE_INFINITY

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

    const pageOffset = records.length
    for (const record of recordPage.records) {
      if (record.submitTime > previousSubmitTime) {
        throw new HttpError('Luogu records are not ordered newest first', 'schema_changed', false)
      }
      previousSubmitTime = record.submitTime
      if (seenRecordIds.has(record.id)) {
        throw new HttpError('Luogu returned a duplicate record ID', 'schema_changed', false)
      }
      seenRecordIds.add(record.id)
      records.push(record)
    }

    recordsRead += recordPage.recordCount
    if (expectedTotal !== null && recordsRead > expectedTotal) {
      throw new HttpError('Luogu returned more records than its total', 'schema_changed', false)
    }

    if (boundaryRecordId !== null && boundaryIndex === null) {
      const localBoundaryIndex = recordPage.records.findIndex(
        (record) => record.id === boundaryRecordId,
      )
      if (localBoundaryIndex >= 0) {
        boundaryIndex = pageOffset + localBoundaryIndex
        break
      }
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

  if (boundaryIndex === null && !complete) {
    throw new HttpError(
      `Luogu record history exceeded the ${maxPages}-page safety limit`,
      'source_unavailable',
      false,
    )
  }

  return { records, pagesRead, recordsRead, totalRecords: expectedTotal, boundaryIndex, complete }
}

function countedProblemIds(records: readonly LuoguAcceptedRecord[]): Set<string> {
  const problemIds = new Set<string>()
  for (const record of records) {
    if (COUNTED_PROBLEM_PID.test(record.problemId)) {
      problemIds.add(record.problemId.toUpperCase())
      if (problemIds.size > MAX_STATE_PROBLEMS) {
        throw new HttpError('Luogu solved-problem state is too large', 'source_unavailable', false)
      }
    }
  }
  return problemIds
}

function nextState(
  accountId: string,
  scan: ScanResult,
  problemIds: Set<string>,
  lastFullSyncAt: string,
): LuoguSyncState {
  const newest = scan.records[0] ?? null
  return {
    accountId,
    boundaryRecordId: newest?.id ?? null,
    boundarySubmitTime: newest?.submitTime ?? null,
    totalRecords: scan.totalRecords,
    problemIds: [...problemIds].sort(),
    lastFullSyncAt,
  }
}

async function synchronizeAcceptedProblems(
  transport: LuoguTransport,
  accountId: string,
  previousStateValue: unknown,
  maxPages: number,
  pageDelayMs: number,
  fetchedAt: string,
  signal?: AbortSignal,
): Promise<SyncMetrics> {
  const previousState = parseSyncState(previousStateValue, accountId)
  const previousFullSyncAt = previousState ? Date.parse(previousState.lastFullSyncAt) : Number.NaN
  const requiresPeriodicFullSync =
    previousState !== null && Date.parse(fetchedAt) - previousFullSyncAt >= FULL_SYNC_INTERVAL_MS

  if (!previousState || previousState.boundaryRecordId === null || requiresPeriodicFullSync) {
    const scan = await scanRecordHistory(transport, accountId, null, maxPages, pageDelayMs, signal)
    const problemIds = countedProblemIds(scan.records)
    return {
      solvedCount: problemIds.size,
      state: nextState(accountId, scan, problemIds, fetchedAt),
      pagesRead: scan.pagesRead,
      recordsRead: scan.recordsRead,
      newRecords: scan.records.length,
      newProblems: problemIds.size,
      syncMode: 'full',
      fallbackReason: requiresPeriodicFullSync ? 'periodic_reconciliation' : null,
    }
  }

  const incrementalScan = await scanRecordHistory(
    transport,
    accountId,
    previousState.boundaryRecordId,
    maxPages,
    pageDelayMs,
    signal,
  )
  const totalDecreased =
    incrementalScan.totalRecords !== null &&
    previousState.totalRecords !== null &&
    incrementalScan.totalRecords < previousState.totalRecords
  const expectedNewRecords =
    incrementalScan.totalRecords !== null && previousState.totalRecords !== null
      ? incrementalScan.totalRecords - previousState.totalRecords
      : null
  const totalDeltaMismatch =
    incrementalScan.boundaryIndex !== null &&
    expectedNewRecords !== null &&
    expectedNewRecords !== incrementalScan.boundaryIndex
  const boundaryTimestampMismatch =
    incrementalScan.boundaryIndex !== null &&
    incrementalScan.records[incrementalScan.boundaryIndex]?.submitTime !==
      previousState.boundarySubmitTime

  if (totalDecreased || totalDeltaMismatch || boundaryTimestampMismatch) {
    const fullScan = await scanRecordHistory(
      transport,
      accountId,
      null,
      maxPages,
      pageDelayMs,
      signal,
    )
    const problemIds = countedProblemIds(fullScan.records)
    return {
      solvedCount: problemIds.size,
      state: nextState(accountId, fullScan, problemIds, fetchedAt),
      pagesRead: incrementalScan.pagesRead + fullScan.pagesRead,
      recordsRead: incrementalScan.recordsRead + fullScan.recordsRead,
      newRecords: fullScan.records.length,
      newProblems: problemIds.size,
      syncMode: 'rebuild',
      fallbackReason: totalDecreased
        ? 'record_total_decreased'
        : boundaryTimestampMismatch
          ? 'boundary_timestamp_mismatch'
          : 'record_total_delta_mismatch',
    }
  }

  if (incrementalScan.boundaryIndex === null) {
    const problemIds = countedProblemIds(incrementalScan.records)
    return {
      solvedCount: problemIds.size,
      state: nextState(accountId, incrementalScan, problemIds, fetchedAt),
      pagesRead: incrementalScan.pagesRead,
      recordsRead: incrementalScan.recordsRead,
      newRecords: incrementalScan.records.length,
      newProblems: problemIds.size,
      syncMode: 'rebuild',
      fallbackReason: 'boundary_record_missing',
    }
  }

  const newRecords = incrementalScan.records.slice(0, incrementalScan.boundaryIndex)
  const problemIds = new Set(previousState.problemIds)
  const previousProblemCount = problemIds.size
  for (const record of newRecords) {
    if (COUNTED_PROBLEM_PID.test(record.problemId)) {
      problemIds.add(record.problemId.toUpperCase())
      if (problemIds.size > MAX_STATE_PROBLEMS) {
        throw new HttpError('Luogu solved-problem state is too large', 'source_unavailable', false)
      }
    }
  }

  return {
    solvedCount: problemIds.size,
    state: nextState(accountId, incrementalScan, problemIds, previousState.lastFullSyncAt),
    pagesRead: incrementalScan.pagesRead,
    recordsRead: incrementalScan.recordsRead,
    newRecords: newRecords.length,
    newProblems: problemIds.size - previousProblemCount,
    syncMode: 'incremental',
    fallbackReason: null,
  }
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
        const fetchedAt = (options.now ?? (() => new Date()))().toISOString()
        const metrics = await synchronizeAcceptedProblems(
          transport,
          accountId,
          context?.syncState,
          maxPages,
          pageDelayMs,
          fetchedAt,
          context?.signal,
        )
        return success(
          'luogu',
          accountId,
          { currentRating: null, maxRating: null, solvedCount: metrics.solvedCount },
          {
            fetchedAt,
            sourceUpdatedAt: null,
            sourceVersion: 'luogu-authenticated-record-list-pb-v4',
            syncState: metrics.state,
            details: {
              provider: 'authenticated_record_list',
              statistic: 'unique currentData.records.result[].problem.pid',
              pidPrefixes: ['P', 'B'],
              syncMode: metrics.syncMode,
              fallbackReason: metrics.fallbackReason,
              pagesRead: metrics.pagesRead,
              recordsRead: metrics.recordsRead,
              newRecords: metrics.newRecords,
              newProblems: metrics.newProblems,
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
