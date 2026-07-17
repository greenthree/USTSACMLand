import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { maxAttemptsForPlatforms, PLATFORM_CONCURRENCY_LIMITS } from './retry.ts'

Deno.test('single-platform jobs have bounded retries while QOJ never retries automatically', () => {
  strictEqual(maxAttemptsForPlatforms(['codeforces']), 3)
  strictEqual(maxAttemptsForPlatforms(['luogu']), 3)
  strictEqual(maxAttemptsForPlatforms(['qoj']), 1)
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
