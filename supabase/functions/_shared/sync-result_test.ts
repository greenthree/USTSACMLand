import { deepStrictEqual } from 'node:assert/strict'
import { memberSyncFailed, summarizeMemberSyncResults } from './sync-result.ts'

Deno.test('member sync treats non-2xx responses as failures', () => {
  deepStrictEqual(
    memberSyncFailed({ memberId: 'member-1', status: 500, body: { error: 'failed' } }),
    true,
  )
})

Deno.test('member sync treats HTTP 207 with a failed body as a failure', () => {
  deepStrictEqual(
    memberSyncFailed({ memberId: 'member-1', status: 207, body: { status: 'failed' } }),
    true,
  )
})

Deno.test('member sync accepts a successful 2xx body', () => {
  deepStrictEqual(
    memberSyncFailed({ memberId: 'member-1', status: 200, body: { status: 'succeeded' } }),
    false,
  )
})

Deno.test('an empty scheduled member set produces a successful no-op summary', () => {
  deepStrictEqual(summarizeMemberSyncResults([]), {
    requested: 0,
    succeeded: 0,
    failed: 0,
  })
})

Deno.test('member sync summaries count successful and failed members', () => {
  deepStrictEqual(
    summarizeMemberSyncResults([
      { memberId: 'member-1', status: 200, body: { status: 'succeeded' } },
      { memberId: 'member-2', status: 207, body: { status: 'failed' } },
    ]),
    {
      requested: 2,
      succeeded: 1,
      failed: 1,
    },
  )
})
