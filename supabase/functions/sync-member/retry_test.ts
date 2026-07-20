import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  maxAttemptsForPlatforms,
  mayAutomaticallyRetryPlatformFailure,
  PLATFORM_CONCURRENCY_LIMITS,
} from './retry.ts'

Deno.test('every single-platform job allows exactly one automatic retry', () => {
  strictEqual(maxAttemptsForPlatforms(['codeforces']), 2)
  strictEqual(maxAttemptsForPlatforms(['luogu']), 2)
  strictEqual(maxAttemptsForPlatforms(['qoj']), 2)
  strictEqual(maxAttemptsForPlatforms(['codeforces', 'atcoder']), 1)
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

Deno.test('all platforms re-enter the queue once only for retryable failures', () => {
  strictEqual(mayAutomaticallyRetryPlatformFailure('qoj', true), true)
  strictEqual(mayAutomaticallyRetryPlatformFailure('qoj', false), false)
  strictEqual(mayAutomaticallyRetryPlatformFailure('nowcoder', true), true)
  strictEqual(mayAutomaticallyRetryPlatformFailure('codeforces', false), false)
})
