import { fetchJson, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface CodeforcesResponse<T> {
  status: 'OK' | 'FAILED'
  result?: T
  comment?: string
}

interface CodeforcesSubmission {
  verdict?: string
  problem?: {
    contestId?: number
    problemsetName?: string
    index?: string
    name?: string
  }
}

export interface CodeforcesTransport {
  fetchUserInfo(accountId: string, signal?: AbortSignal): Promise<unknown>
  fetchSubmissions(
    accountId: string,
    from: number,
    count: number,
    signal?: AbortSignal,
  ): Promise<unknown>
}

export interface CodeforcesAdapterOptions {
  transport?: CodeforcesTransport
  maxPages?: number
}

const API_BASE = 'https://codeforces.com/api'
const PAGE_SIZE = 1_000

type ParsedEnvelope = { ok: true; result: unknown } | { ok: false; failure: AdapterResult }

const defaultTransport: CodeforcesTransport = {
  fetchUserInfo(accountId, signal) {
    const encoded = encodeURIComponent(accountId)
    return fetchJson<unknown>(
      `${API_BASE}/user.info?handles=${encoded}&checkHistoricHandles=false`,
      { signal, timeoutMs: 12_000, retries: 2 },
    )
  },

  fetchSubmissions(accountId, from, count, signal) {
    const encoded = encodeURIComponent(accountId)
    return fetchJson<unknown>(
      `${API_BASE}/user.status?handle=${encoded}&from=${from}&count=${count}`,
      {
        signal,
        timeoutMs: 15_000,
        retries: 2,
        retryBaseMs: 500,
      },
    )
  },
}

function resolveMaxPages(configured: number | undefined): number {
  const value = configured ?? Number(Deno.env.get('CODEFORCES_MAX_PAGES') ?? '100')
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : 100
}

function apiFailure(accountId: string, response: CodeforcesResponse<unknown>): AdapterResult {
  const comment =
    typeof response.comment === 'string' && response.comment.trim()
      ? response.comment
      : 'Codeforces API rejected the request'
  const notFound = /not found/i.test(comment)
  const rateLimited = /limit exceeded|too many requests/i.test(comment)
  return failure(
    'codeforces',
    accountId,
    notFound ? 'not_found' : rateLimited ? 'rate_limited' : 'source_unavailable',
    comment,
    !notFound,
  )
}

function schemaFailure(
  accountId: string,
  endpoint: 'user.info' | 'user.status',
  reason: string,
): AdapterResult {
  return failure(
    'codeforces',
    accountId,
    'schema_changed',
    `Codeforces ${endpoint} response ${reason}`,
    false,
    { endpoint },
  )
}

function parseEnvelope(
  accountId: string,
  endpoint: 'user.info' | 'user.status',
  payload: unknown,
): ParsedEnvelope {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, failure: schemaFailure(accountId, endpoint, 'is not an object') }
  }

  const response = payload as Record<string, unknown>
  if (response.status === 'FAILED') {
    return {
      ok: false,
      failure: apiFailure(accountId, {
        status: 'FAILED',
        comment: typeof response.comment === 'string' ? response.comment : undefined,
      }),
    }
  }
  if (response.status !== 'OK') {
    return { ok: false, failure: schemaFailure(accountId, endpoint, 'has an unknown status') }
  }
  if (!('result' in response)) {
    return { ok: false, failure: schemaFailure(accountId, endpoint, 'is missing its result') }
  }

  return { ok: true, result: response.result }
}

function optionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function problemKey(submission: CodeforcesSubmission): string | null {
  const problem = submission.problem
  if (!problem || typeof problem.index !== 'string' || !problem.index.trim()) return null
  if (Number.isSafeInteger(problem.contestId)) return `${problem.contestId}:${problem.index}`
  if (typeof problem.problemsetName === 'string' && problem.problemsetName.trim()) {
    return `${problem.problemsetName}:${problem.index}`
  }
  return typeof problem.name === 'string' && problem.name.trim()
    ? `${problem.name}:${problem.index}`
    : null
}

export function createCodeforcesAdapter(options: CodeforcesAdapterOptions = {}): PlatformAdapter {
  const transport = options.transport ?? defaultTransport
  return {
    platform: 'codeforces',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      if (!/^[\w.-]{3,24}$/.test(accountId)) {
        return failure(
          'codeforces',
          accountId,
          'invalid_account',
          'Invalid Codeforces handle format',
          false,
        )
      }

      try {
        const infoEnvelope = parseEnvelope(
          accountId,
          'user.info',
          await transport.fetchUserInfo(accountId, context?.signal),
        )
        if (!infoEnvelope.ok) return infoEnvelope.failure
        if (!Array.isArray(infoEnvelope.result) || infoEnvelope.result.length !== 1) {
          return schemaFailure(accountId, 'user.info', 'does not contain exactly one user')
        }

        const rawUser = infoEnvelope.result[0]
        if (typeof rawUser !== 'object' || rawUser === null || Array.isArray(rawUser)) {
          return schemaFailure(accountId, 'user.info', 'contains an invalid user')
        }
        const user = rawUser as Record<string, unknown>
        if (typeof user.handle !== 'string' || !user.handle.trim()) {
          return schemaFailure(accountId, 'user.info', 'contains an invalid canonical handle')
        }
        const canonicalHandle = user.handle
        const currentRating = optionalFiniteNumber(user.rating)
        const maxRating = optionalFiniteNumber(user.maxRating)
        if (currentRating === undefined || maxRating === undefined) {
          return schemaFailure(accountId, 'user.info', 'contains an invalid Rating')
        }

        const accepted = new Set<string>()
        const maxPages = resolveMaxPages(options.maxPages)
        let pagesRead = 0
        let complete = false

        for (let page = 0; page < maxPages; page += 1) {
          const from = page * PAGE_SIZE + 1
          const submissionsEnvelope = parseEnvelope(
            accountId,
            'user.status',
            await transport.fetchSubmissions(accountId, from, PAGE_SIZE, context?.signal),
          )
          if (!submissionsEnvelope.ok) return submissionsEnvelope.failure
          if (!Array.isArray(submissionsEnvelope.result)) {
            return schemaFailure(accountId, 'user.status', 'result is not an array')
          }

          pagesRead += 1
          for (const rawSubmission of submissionsEnvelope.result) {
            if (
              typeof rawSubmission !== 'object' ||
              rawSubmission === null ||
              Array.isArray(rawSubmission)
            ) {
              return schemaFailure(accountId, 'user.status', 'contains an invalid submission')
            }
            const submission = rawSubmission as CodeforcesSubmission
            if (submission.verdict !== 'OK') continue
            const key = problemKey(submission)
            if (!key) {
              return schemaFailure(
                accountId,
                'user.status',
                'contains an Accepted submission without a stable problem identifier',
              )
            }
            accepted.add(key)
          }
          if (submissionsEnvelope.result.length < PAGE_SIZE) {
            complete = true
            break
          }
        }

        if (!complete) {
          return failure(
            'codeforces',
            accountId,
            'source_unavailable',
            `Submission history exceeded the ${maxPages}-page safety limit`,
            false,
            { pagesRead, pageSize: PAGE_SIZE },
          )
        }

        return success(
          'codeforces',
          canonicalHandle,
          {
            currentRating,
            maxRating,
            solvedCount: accepted.size,
          },
          {
            sourceUpdatedAt: null,
            sourceVersion: 'codeforces-api-v1',
            details: { pagesRead },
          },
        )
      } catch (error) {
        if (error instanceof HttpError && error.responseBody) {
          try {
            const response = JSON.parse(error.responseBody) as CodeforcesResponse<unknown>
            if (response.status === 'FAILED') return apiFailure(accountId, response)
          } catch {
            // Fall through to the generic HTTP classification.
          }
        }
        const normalized = toAdapterHttpError(error)
        return failure(
          'codeforces',
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

export const codeforcesAdapter = createCodeforcesAdapter()
