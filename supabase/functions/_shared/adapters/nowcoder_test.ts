import { deepStrictEqual, throws } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import {
  createNowcoderAdapter,
  parseFirecrawlNowcoderMetrics,
  parseNowcoderPracticePage,
  parseNowcoderRatingHistory,
  type NowcoderMetricsProvider,
} from './nowcoder.ts'

const fixtureBase = new URL('./testdata/', import.meta.url)

function fixture(name: string): Promise<string> {
  return Deno.readTextFile(new URL(name, fixtureBase))
}

Deno.test('Nowcoder practice parser reads the aggregate unique solved count', async () => {
  const solvedCount = parseNowcoderPracticePage(
    {
      html: await fixture('nowcoder-practice-rated.html'),
      finalUrl: 'https://ac.nowcoder.com/acm/contest/profile/123456789/practice-coding?pageSize=1',
    },
    '123456789',
  )

  deepStrictEqual(solvedCount, 263)
})

Deno.test(
  'Nowcoder practice parser accepts a valid account with zero solved problems',
  async () => {
    const solvedCount = parseNowcoderPracticePage(
      {
        html: await fixture('nowcoder-practice-zero.html'),
        finalUrl: 'https://ac.nowcoder.com/acm/contest/profile/123456789/practice-coding',
      },
      '123456789',
    )

    deepStrictEqual(solvedCount, 0)
  },
)

Deno.test('Nowcoder practice parser distinguishes a missing user from schema changes', async () => {
  const html = await fixture('nowcoder-user-missing.html')

  throws(
    () =>
      parseNowcoderPracticePage(
        {
          html,
          finalUrl: 'https://ac.nowcoder.com/acm/contest/profile/1/practice-coding',
        },
        '1',
      ),
    HttpError,
    'Nowcoder user was not found',
  )
})

Deno.test('Nowcoder rating parser uses the latest contest and historical maximum', async () => {
  const payload = JSON.parse(await fixture('nowcoder-rating-history.json')) as unknown
  const metrics = parseNowcoderRatingHistory(payload)

  deepStrictEqual(metrics, {
    currentRating: 1490,
    maxRating: 1600,
    ratedContestCount: 3,
    lastRatedAt: new Date(1710000000000).toISOString(),
  })
})

Deno.test('Nowcoder rating parser treats an empty history as an unrated valid account', () => {
  deepStrictEqual(parseNowcoderRatingHistory({ code: 0, msg: 'OK', data: [] }), {
    currentRating: null,
    maxRating: null,
    ratedContestCount: 0,
    lastRatedAt: null,
  })
})

Deno.test('Nowcoder Firecrawl parser validates rated and unrated structured results', async () => {
  const rated = parseFirecrawlNowcoderMetrics(
    JSON.parse(await fixture('nowcoder-firecrawl-rated.json')) as unknown,
    '123456789',
  )
  const unrated = parseFirecrawlNowcoderMetrics(
    JSON.parse(await fixture('nowcoder-firecrawl-unrated.json')) as unknown,
    '123456789',
  )

  deepStrictEqual(rated, {
    currentRating: 1490,
    maxRating: 1600,
    solvedCount: 263,
    ratedContestCount: 3,
    lastRatedAt: null,
    sourceVersion: 'nowcoder-firecrawl-profile-v1',
    provider: 'firecrawl',
  })
  deepStrictEqual(unrated.currentRating, null)
  deepStrictEqual(unrated.maxRating, null)
  deepStrictEqual(unrated.solvedCount, 39)
})

Deno.test('Nowcoder Firecrawl parser distinguishes a missing profile', () => {
  throws(
    () =>
      parseFirecrawlNowcoderMetrics(
        {
          success: true,
          data: {
            actions: {
              javascriptReturns: [
                {
                  type: 'object',
                  value: {
                    uid: null,
                    isProfile: false,
                    currentRating: null,
                    maxRating: null,
                    solvedCount: null,
                    ratingPoints: 0,
                  },
                },
              ],
            },
          },
        },
        '999999999999999999',
      ),
    HttpError,
    'Nowcoder user was not found',
  )
})

Deno.test('Nowcoder adapter combines rating history and solved count atomically', async () => {
  const primary: NowcoderMetricsProvider = {
    fetchMetrics() {
      return Promise.resolve({
        currentRating: 1490,
        maxRating: 1600,
        solvedCount: 263,
        ratedContestCount: 3,
        lastRatedAt: new Date(1710000000000).toISOString(),
        sourceVersion: 'nowcoder-rating-history-practice-v1',
        provider: 'direct',
      })
    },
  }

  const result = await createNowcoderAdapter({ primary, fallback: null }).sync(' 123456789 ')

  deepStrictEqual(result.ok, true)
  if (!result.ok) return
  deepStrictEqual(result.accountId, '123456789')
  deepStrictEqual(result.metrics, {
    currentRating: 1490,
    maxRating: 1600,
    solvedCount: 263,
  })
  deepStrictEqual(result.sourceVersion, 'nowcoder-rating-history-practice-v1')
})

Deno.test('Nowcoder adapter rejects non-numeric UIDs before making requests', async () => {
  let requests = 0
  const primary: NowcoderMetricsProvider = {
    fetchMetrics() {
      requests += 1
      throw new Error('should not run')
    },
  }

  const result = await createNowcoderAdapter({ primary, fallback: null }).sync('user-name')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'invalid_account')
  deepStrictEqual(requests, 0)
})

Deno.test('Nowcoder adapter preserves retryable upstream classifications', async () => {
  const primary: NowcoderMetricsProvider = {
    fetchMetrics() {
      throw new HttpError('Too many requests', 'rate_limited', true, 429)
    },
  }

  const result = await createNowcoderAdapter({ primary, fallback: null }).sync('123456789')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'rate_limited')
  deepStrictEqual(result.error.retryable, true)
  deepStrictEqual(result.error.details, {
    httpStatus: 429,
    firecrawlFallbackConfigured: false,
  })
})

Deno.test('Nowcoder adapter falls back to Firecrawl after an anti-bot response', async () => {
  const primary: NowcoderMetricsProvider = {
    fetchMetrics() {
      throw new HttpError('Anti-bot challenge', 'source_unavailable', true)
    },
  }
  const fallback: NowcoderMetricsProvider = {
    fetchMetrics() {
      return Promise.resolve({
        currentRating: 1490,
        maxRating: 1600,
        solvedCount: 263,
        ratedContestCount: 3,
        lastRatedAt: null,
        sourceVersion: 'nowcoder-firecrawl-profile-v1',
        provider: 'firecrawl',
      })
    },
  }

  const result = await createNowcoderAdapter({ primary, fallback }).sync('123456789')

  deepStrictEqual(result.ok, true)
  if (!result.ok) return
  deepStrictEqual(result.sourceVersion, 'nowcoder-firecrawl-profile-v1')
  deepStrictEqual(result.details?.provider, 'firecrawl')
})

Deno.test('Nowcoder parser reports a changed practice-page structure', () => {
  throws(
    () =>
      parseNowcoderPracticePage(
        {
          html: '<html><body><div class="profile-status-box"></div></body></html>',
          finalUrl: 'https://ac.nowcoder.com/acm/contest/profile/123/practice-coding',
        },
        '123',
      ),
    HttpError,
    'Nowcoder solved count is missing',
  )
})
