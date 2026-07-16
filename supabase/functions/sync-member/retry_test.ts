import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { failure, success } from '../_shared/adapters/types.ts'
import { maxAttemptsForPlatforms, nextRetryAt, PLATFORM_CONCURRENCY_LIMITS } from './retry.ts'

const now = new Date('2026-07-14T00:00:00.000Z')

Deno.test('single-platform jobs have bounded retries while QOJ never retries automatically', () => {
  strictEqual(maxAttemptsForPlatforms(['codeforces']), 3)
  strictEqual(maxAttemptsForPlatforms(['luogu']), 3)
  strictEqual(maxAttemptsForPlatforms(['qoj']), 1)
  strictEqual(maxAttemptsForPlatforms(['codeforces', 'atcoder']), 1)
})

Deno.test('retryable failures use deterministic exponential backoff', () => {
  const failed = [failure('codeforces', 'tourist', 'timeout', 'timed out', true)]

  strictEqual(nextRetryAt(['codeforces'], failed, 1, now), '2026-07-14T00:02:00.000Z')
  strictEqual(nextRetryAt(['codeforces'], failed, 2, now), '2026-07-14T00:04:00.000Z')
  strictEqual(nextRetryAt(['codeforces'], failed, 3, now), null)
})

Deno.test('successful, permanent, multi-platform, and QOJ results are not requeued', () => {
  const succeeded = [
    success(
      'codeforces',
      'tourist',
      { currentRating: 3800, maxRating: 4000, solvedCount: 1_000 },
      { sourceUpdatedAt: null, sourceVersion: 'fixture' },
    ),
  ]
  const permanent = [failure('codeforces', 'missing', 'not_found', 'missing', false)]
  const qoj = [failure('qoj', 'member', 'rate_limited', 'limited', true)]

  strictEqual(nextRetryAt(['codeforces'], succeeded, 1, now), null)
  strictEqual(nextRetryAt(['codeforces'], permanent, 1, now), null)
  strictEqual(nextRetryAt(['codeforces', 'atcoder'], permanent, 1, now), null)
  strictEqual(nextRetryAt(['qoj'], qoj, 1, now), null)
})

Deno.test('platform concurrency limits keep expensive sources serialized', () => {
  deepStrictEqual(PLATFORM_CONCURRENCY_LIMITS, {
    codeforces: 2,
    nowcoder: 1,
    atcoder: 2,
    xcpc_elo: 4,
    luogu: 1,
    qoj: 1,
  })
})
