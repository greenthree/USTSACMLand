import { deepStrictEqual, throws } from 'node:assert/strict'
import { normalizeSyncRequest, SyncRequestError } from './request.ts'

Deno.test('platforms scope removes duplicate platforms while preserving order', () => {
  deepStrictEqual(
    normalizeSyncRequest({
      scope: 'platforms',
      platforms: ['codeforces', 'nowcoder', 'codeforces', 'atcoder'],
    }),
    {
      scope: 'platforms',
      platforms: ['codeforces', 'nowcoder', 'atcoder'],
    },
  )
})

Deno.test('platforms scope rejects an empty platform group', () => {
  throws(
    () => normalizeSyncRequest({ scope: 'platforms', platforms: [] }),
    SyncRequestError,
    'platforms must be a non-empty array',
  )
})

Deno.test('platforms scope rejects unsupported platforms', () => {
  throws(
    () =>
      normalizeSyncRequest({
        scope: 'platforms',
        platforms: ['codeforces', 'unknown'] as never,
      }),
    SyncRequestError,
    'platforms contains an unsupported platform',
  )
})

Deno.test('legacy single-platform requests normalize to one platform', () => {
  deepStrictEqual(normalizeSyncRequest({ scope: 'platform', platform: 'luogu' }), {
    scope: 'platform',
    platforms: ['luogu'],
  })
})

Deno.test('member scope validates and normalizes its UUID', () => {
  deepStrictEqual(
    normalizeSyncRequest({
      scope: 'member',
      member_id: '8a7c4494-97b0-4c5e-a386-02b0efcf22c7',
    }),
    {
      scope: 'member',
      memberId: '8a7c4494-97b0-4c5e-a386-02b0efcf22c7',
    },
  )
})
