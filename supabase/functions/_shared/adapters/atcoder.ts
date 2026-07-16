import { fetchJson, fetchWithRetry, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface AtCoderHistoryEntry {
  IsRated?: unknown
  NewRating?: unknown
  EndTime?: unknown
}

interface AtCoderAcRankResponse {
  count?: unknown
  rank?: unknown
}

export interface AtCoderAcRank {
  count: number
  rank: number | null
}

interface ParsedAtCoderHistory {
  ratings: number[]
  sourceUpdatedAt: string | null
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

function parseAtCoderHistory(payload: unknown): ParsedAtCoderHistory {
  if (!Array.isArray(payload)) {
    throw new HttpError('AtCoder history response is not an array', 'schema_changed', false)
  }

  const ratings: number[] = []
  let sourceUpdatedAt: string | null = null
  let previousRatedAt = Number.NEGATIVE_INFINITY

  for (const rawEntry of payload) {
    if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) {
      throw new HttpError('AtCoder history contains an invalid entry', 'schema_changed', false)
    }

    const entry = rawEntry as AtCoderHistoryEntry
    if (typeof entry.IsRated !== 'boolean') {
      throw new HttpError('AtCoder history contains an invalid rated flag', 'schema_changed', false)
    }
    if (!entry.IsRated) continue
    if (typeof entry.NewRating !== 'number' || !Number.isFinite(entry.NewRating)) {
      throw new HttpError('AtCoder history contains an invalid Rating', 'schema_changed', false)
    }
    if (typeof entry.EndTime !== 'string') {
      throw new HttpError(
        'AtCoder history contains an invalid contest time',
        'schema_changed',
        false,
      )
    }

    const timestamp = Date.parse(entry.EndTime)
    if (!Number.isFinite(timestamp)) {
      throw new HttpError(
        'AtCoder history contains an invalid contest time',
        'schema_changed',
        false,
      )
    }
    if (timestamp < previousRatedAt) {
      throw new HttpError(
        'AtCoder rated history is not ordered chronologically',
        'schema_changed',
        false,
      )
    }

    previousRatedAt = timestamp
    ratings.push(entry.NewRating)
    sourceUpdatedAt = new Date(timestamp).toISOString()
  }

  return { ratings, sourceUpdatedAt }
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
        const history = parseAtCoderHistory(historyPayload)
        const ratings = history.ratings

        return success(
          'atcoder',
          accountId,
          {
            currentRating: ratings.length > 0 ? ratings.at(-1)! : null,
            maxRating: ratings.length > 0 ? Math.max(...ratings) : null,
            solvedCount: acRank.count,
          },
          {
            sourceUpdatedAt: history.sourceUpdatedAt,
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
