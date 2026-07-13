import { fetchJson, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface CodeforcesResponse<T> {
  status: 'OK' | 'FAILED'
  result?: T
  comment?: string
}

interface CodeforcesUser {
  handle: string
  rating?: number
  maxRating?: number
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

const API_BASE = 'https://codeforces.com/api'
const PAGE_SIZE = 1_000

function apiFailure(accountId: string, response: CodeforcesResponse<unknown>): AdapterResult {
  const comment = response.comment ?? 'Codeforces API rejected the request'
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

function problemKey(submission: CodeforcesSubmission): string | null {
  const problem = submission.problem
  if (!problem?.index) return null
  if (problem.contestId !== undefined) {
    return `${problem.contestId}:${problem.index}`
  }
  if (problem.problemsetName) {
    return `${problem.problemsetName}:${problem.index}`
  }
  return problem.name ? `${problem.name}:${problem.index}` : null
}

export const codeforcesAdapter: PlatformAdapter = {
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
      const encoded = encodeURIComponent(accountId)
      const info = await fetchJson<CodeforcesResponse<CodeforcesUser[]>>(
        `${API_BASE}/user.info?handles=${encoded}&checkHistoricHandles=false`,
        { signal: context?.signal, timeoutMs: 12_000, retries: 2 },
      )
      if (info.status !== 'OK' || !Array.isArray(info.result) || info.result.length !== 1) {
        return apiFailure(accountId, info)
      }

      const accepted = new Set<string>()
      const maxPages = Math.max(1, Number(Deno.env.get('CODEFORCES_MAX_PAGES') ?? '100'))
      let pagesRead = 0
      let complete = false

      for (let page = 0; page < maxPages; page += 1) {
        const from = page * PAGE_SIZE + 1
        const submissions = await fetchJson<CodeforcesResponse<CodeforcesSubmission[]>>(
          `${API_BASE}/user.status?handle=${encoded}&from=${from}&count=${PAGE_SIZE}`,
          {
            signal: context?.signal,
            timeoutMs: 15_000,
            retries: 2,
            retryBaseMs: 500,
          },
        )
        if (submissions.status !== 'OK' || !Array.isArray(submissions.result)) {
          return apiFailure(accountId, submissions)
        }

        pagesRead += 1
        for (const submission of submissions.result) {
          if (submission.verdict !== 'OK') continue
          const key = problemKey(submission)
          if (key) accepted.add(key)
        }
        if (submissions.result.length < PAGE_SIZE) {
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

      const user = info.result[0]
      return success(
        'codeforces',
        user.handle,
        {
          currentRating: Number.isFinite(user.rating) ? user.rating! : null,
          maxRating: Number.isFinite(user.maxRating) ? user.maxRating! : null,
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
          if (response.status === 'FAILED') {
            return apiFailure(accountId, response)
          }
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
