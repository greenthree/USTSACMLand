import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict'
import {
  adminSyncRateLimitRule,
  maySyncXcpcElo,
  normalizeSyncRequest,
  SyncRequestError,
} from './request.ts'

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

Deno.test('XCPC cache preparation is selected only when the request can include XCPC ELO', () => {
  strictEqual(maySyncXcpcElo(normalizeSyncRequest({ scope: 'all' })), true)
  strictEqual(
    maySyncXcpcElo(
      normalizeSyncRequest({ scope: 'platforms', platforms: ['codeforces', 'xcpc_elo'] }),
    ),
    true,
  )
  strictEqual(
    maySyncXcpcElo(normalizeSyncRequest({ scope: 'platform', platform: 'codeforces' })),
    false,
  )
  strictEqual(maySyncXcpcElo(normalizeSyncRequest({ scope: 'queue' })), false)
})

Deno.test('queue scope does not require a member target', () => {
  deepStrictEqual(normalizeSyncRequest({ scope: 'queue' }), { scope: 'queue' })
})

Deno.test('scheduled requests accept bounded cursor pagination', () => {
  deepStrictEqual(
    normalizeSyncRequest({
      scope: 'platform',
      platform: 'nowcoder',
      batch_size: 3,
      cursor: 42,
    }),
    {
      scope: 'platform',
      platforms: ['nowcoder'],
      batchSize: 3,
      cursor: 42,
    },
  )
})

Deno.test('pagination rejects unsafe sizes, cursors, and queue use', () => {
  throws(
    () => normalizeSyncRequest({ scope: 'all', batch_size: 0 }),
    SyncRequestError,
    'batch_size must be an integer between 1 and 12',
  )
  throws(
    () => normalizeSyncRequest({ scope: 'all', cursor: 1 }),
    SyncRequestError,
    'cursor requires batch_size',
  )
  throws(
    () => normalizeSyncRequest({ scope: 'queue', batch_size: 3 }),
    SyncRequestError,
    'queue scope does not accept pagination',
  )
})

Deno.test('administrator pagination preserves operation and continuation limits', () => {
  deepStrictEqual(adminSyncRateLimitRule(normalizeSyncRequest({ scope: 'all', batch_size: 6 })), {
    actionKey: 'admin.sync.all',
    maxRequests: 2,
    windowSeconds: 600,
  })
  deepStrictEqual(
    adminSyncRateLimitRule(normalizeSyncRequest({ scope: 'all', batch_size: 6, cursor: 42 })),
    {
      actionKey: 'admin.sync.all.page',
      maxRequests: 60,
      windowSeconds: 600,
    },
  )
  deepStrictEqual(
    adminSyncRateLimitRule(
      normalizeSyncRequest({ scope: 'platform', platform: 'luogu', batch_size: 6, cursor: 42 }),
    ),
    {
      actionKey: 'admin.sync.scoped.page',
      maxRequests: 120,
      windowSeconds: 60,
    },
  )
})
