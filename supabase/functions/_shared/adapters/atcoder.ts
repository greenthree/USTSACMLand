import { fetchJson, fetchWithRetry, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface AtCoderHistoryEntry {
  IsRated?: boolean
  NewRating?: number
  EndTime?: string
}

export const atcoderAdapter: PlatformAdapter = {
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
      const history = await fetchJson<AtCoderHistoryEntry[]>(
        `https://atcoder.jp/users/${encodeURIComponent(accountId)}/history/json`,
        {
          signal: context?.signal,
          timeoutMs: 12_000,
          retries: 2,
          headers: { 'user-agent': 'USTSACMLand/1.0 (rating sync)' },
        },
      )
      if (!Array.isArray(history)) {
        return failure(
          'atcoder',
          accountId,
          'schema_changed',
          'AtCoder history response is not an array',
          false,
        )
      }
      if (history.length === 0) {
        // The history endpoint returns [] for both unrated and nonexistent users.
        // The profile request distinguishes those cases without inventing a rating.
        await fetchWithRetry(`https://atcoder.jp/users/${encodeURIComponent(accountId)}`, {
          signal: context?.signal,
          timeoutMs: 12_000,
          retries: 2,
          headers: { 'user-agent': 'USTSACMLand/1.0 (rating sync)' },
        })
      }

      const rated = history.filter((entry) => entry.IsRated && Number.isFinite(entry.NewRating))
      const ratings = rated.map((entry) => entry.NewRating as number)
      const last = rated.at(-1)

      return success(
        'atcoder',
        accountId,
        {
          currentRating: ratings.length > 0 ? ratings.at(-1)! : null,
          maxRating: ratings.length > 0 ? Math.max(...ratings) : null,
          solvedCount: null,
        },
        {
          sourceUpdatedAt: last?.EndTime ? new Date(last.EndTime).toISOString() : null,
          sourceVersion: 'atcoder-history-json-v1',
          details: { ratedContestCount: ratings.length },
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
