import { fetchJson, fetchWithRetry, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface AtCoderHistoryEntry {
  IsRated?: boolean
  NewRating?: number
  EndTime?: string
}

interface AtCoderAcRankResponse {
  count?: unknown
  rank?: unknown
}

export interface AtCoderAcRank {
  count: number
  rank: number | null
}

export interface AtCoderTransport {
  fetchHistory(accountId: string, signal?: AbortSignal): Promise<unknown>
  fetchAcRank(accountId: string, signal?: AbortSignal): Promise<unknown>
  verifyProfile(accountId: string, signal?: AbortSignal): Promise<void>
}

const USER_AGENT = 'USTSACMLand/1.0 (rating and solved-count sync)'

const defaultTransport: AtCoderTransport = {
  fetchHistory(accountId, signal) {
    return fetchJson<unknown>(
      `https://atcoder.jp/users/${encodeURIComponent(accountId)}/history/json`,
      {
        signal,
        timeoutMs: 12_000,
        retries: 2,
        headers: { 'user-agent': USER_AGENT },
      },
    )
  },
  fetchAcRank(accountId, signal) {
    return fetchJson<unknown>(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user=${encodeURIComponent(accountId)}`,
      {
        signal,
        timeoutMs: 12_000,
        retries: 2,
        headers: { 'user-agent': USER_AGENT },
      },
    )
  },
  async verifyProfile(accountId, signal) {
    await fetchWithRetry(`https://atcoder.jp/users/${encodeURIComponent(accountId)}`, {
      signal,
      timeoutMs: 12_000,
      retries: 2,
      headers: { 'user-agent': USER_AGENT },
    })
  },
}

export function parseAtCoderAcRank(payload: unknown): AtCoderAcRank {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError('AtCoder AC rank response is not an object', 'schema_changed', false)
  }
  const response = payload as AtCoderAcRankResponse
  if (
    typeof response.count !== 'number' ||
    !Number.isSafeInteger(response.count) ||
    response.count < 0
  ) {
    throw new HttpError('AtCoder AC rank count is invalid', 'schema_changed', false)
  }
  if (
    response.rank !== undefined &&
    (typeof response.rank !== 'number' || !Number.isSafeInteger(response.rank) || response.rank < 1)
  ) {
    throw new HttpError('AtCoder AC rank position is invalid', 'schema_changed', false)
  }
  return { count: response.count, rank: (response.rank as number | undefined) ?? null }
}

async function loadSolvedCount(
  transport: AtCoderTransport,
  accountId: string,
  signal?: AbortSignal,
): Promise<AtCoderAcRank> {
  try {
    return parseAtCoderAcRank(await transport.fetchAcRank(accountId, signal))
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error
    await transport.verifyProfile(accountId, signal)
    return { count: 0, rank: null }
  }
}

export function createAtCoderAdapter(
  transport: AtCoderTransport = defaultTransport,
): PlatformAdapter {
  return {
    platform: 'atcoder',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      if (!/^[A-Za-z0-9_]{1,30}$/.test(accountId)) {
        return failure(
          'atcoder',
          accountId,
          'invalid_account',
          'Invalid AtCoder username format',
          false,
        )
      }

      try {
        const [historyPayload, acRank] = await Promise.all([
          transport.fetchHistory(accountId, context?.signal),
          loadSolvedCount(transport, accountId, context?.signal),
        ])
        if (!Array.isArray(historyPayload)) {
          return failure(
            'atcoder',
            accountId,
            'schema_changed',
            'AtCoder history response is not an array',
            false,
          )
        }

        const history = historyPayload as AtCoderHistoryEntry[]
        const rated = history.filter((entry) => entry.IsRated && Number.isFinite(entry.NewRating))
        const ratings = rated.map((entry) => entry.NewRating as number)
        const last = rated.at(-1)

        return success(
          'atcoder',
          accountId,
          {
            currentRating: ratings.length > 0 ? ratings.at(-1)! : null,
            maxRating: ratings.length > 0 ? Math.max(...ratings) : null,
            solvedCount: acRank.count,
          },
          {
            sourceUpdatedAt: last?.EndTime ? new Date(last.EndTime).toISOString() : null,
            sourceVersion: 'atcoder-history-ac-rank-v2',
            details: { ratedContestCount: ratings.length, acRank: acRank.rank },
          },
        )
      } catch (error) {
        const normalized = toAdapterHttpError(error)
        return failure(
          'atcoder',
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

export const atcoderAdapter = createAtCoderAdapter()
