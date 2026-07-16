import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import {
  type RecoveryLeaseClient,
  RecoveryLeaseUnavailableError,
  withRecoveryFloorLease,
} from './recovery-lease.ts'

const OWNER = '10000000-0000-4000-8000-000000000001'

function client(
  handler: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
): RecoveryLeaseClient {
  return { rpc: handler }
}

Deno.test('account deletion recovery lease wraps and releases the critical section', async () => {
  const calls: Array<string | { name: string; args: Record<string, unknown> }> = []
  const result = await withRecoveryFloorLease(
    client((name, args) => {
      calls.push({ name, args })
      return Promise.resolve({ data: true, error: null })
    }),
    () => {
      calls.push('critical-section')
      return Promise.resolve('completed')
    },
    OWNER,
  )

  equal(result, 'completed')
  deepStrictEqual(calls, [
    {
      name: 'acquire_account_deletion_recovery_lease',
      args: { p_owner_token: OWNER },
    },
    'critical-section',
    {
      name: 'release_account_deletion_recovery_lease',
      args: { p_owner_token: OWNER },
    },
  ])
})

Deno.test('an acquisition transport failure is reported as lease unavailable', async () => {
  let actionCalled = false
  await rejects(
    () =>
      withRecoveryFloorLease(
        client(() => Promise.reject(new Error('database transport failed'))),
        () => {
          actionCalled = true
          return Promise.resolve()
        },
        OWNER,
      ),
    RecoveryLeaseUnavailableError,
  )
  equal(actionCalled, false)
})

Deno.test('the critical section can renew and reconfirm lease ownership', async () => {
  const calls: string[] = []
  const result = await withRecoveryFloorLease(
    client((name) => {
      calls.push(name)
      return Promise.resolve({ data: true, error: null })
    }),
    async (renew) => {
      calls.push('floor:confirmed')
      await renew()
      calls.push('auth:delete')
      return 'completed'
    },
    OWNER,
  )

  equal(result, 'completed')
  deepStrictEqual(calls, [
    'acquire_account_deletion_recovery_lease',
    'floor:confirmed',
    'renew_account_deletion_recovery_lease',
    'auth:delete',
    'release_account_deletion_recovery_lease',
  ])
})

Deno.test('a renewal transport failure is reported before later critical work', async () => {
  const calls: string[] = []
  await rejects(
    () =>
      withRecoveryFloorLease(
        client((name) => {
          calls.push(name)
          if (name === 'renew_account_deletion_recovery_lease') {
            return Promise.reject(new Error('database transport failed'))
          }
          return Promise.resolve({ data: true, error: null })
        }),
        async (renew) => {
          await renew()
          calls.push('must-not-run')
        },
        OWNER,
      ),
    RecoveryLeaseUnavailableError,
  )
  deepStrictEqual(calls, [
    'acquire_account_deletion_recovery_lease',
    'renew_account_deletion_recovery_lease',
    'release_account_deletion_recovery_lease',
  ])
})

Deno.test('the lease heartbeat renews while a long critical action is pending', async () => {
  const calls: string[] = []
  let renewalCount = 0
  let markTwoRenewals: (() => void) | undefined
  let finishAction: ((value: string) => void) | undefined
  const twoRenewals = new Promise<void>((resolve) => {
    markTwoRenewals = resolve
  })
  const pendingAction = new Promise<string>((resolve) => {
    finishAction = resolve
  })
  const operation = withRecoveryFloorLease(
    client((name) => {
      calls.push(name)
      if (name === 'renew_account_deletion_recovery_lease') {
        renewalCount += 1
        if (renewalCount >= 2) markTwoRenewals?.()
      }
      return Promise.resolve({ data: true, error: null })
    }),
    () => pendingAction,
    OWNER,
    { heartbeatIntervalMs: 5 },
  )

  await twoRenewals
  equal(calls.includes('release_account_deletion_recovery_lease'), false)
  finishAction?.('completed')
  equal(await operation, 'completed')
  equal(renewalCount >= 2, true)
  equal(calls.at(-1), 'release_account_deletion_recovery_lease')
})

Deno.test('heartbeat failure is reported without masking a completed critical action', async () => {
  const calls: string[] = []
  let markHeartbeatFailure: (() => void) | undefined
  const heartbeatFailed = new Promise<void>((resolve) => {
    markHeartbeatFailure = resolve
  })
  const result = await withRecoveryFloorLease(
    client((name) => {
      calls.push(name)
      if (name === 'renew_account_deletion_recovery_lease') {
        return Promise.resolve({ data: false, error: null })
      }
      return Promise.resolve({ data: true, error: null })
    }),
    async () => {
      await heartbeatFailed
      return 'deleted'
    },
    OWNER,
    {
      heartbeatIntervalMs: 5,
      reportHeartbeatFailure() {
        calls.push('heartbeat:reported')
        markHeartbeatFailure?.()
      },
    },
  )

  equal(result, 'deleted')
  deepStrictEqual(calls, [
    'acquire_account_deletion_recovery_lease',
    'renew_account_deletion_recovery_lease',
    'heartbeat:reported',
    'release_account_deletion_recovery_lease',
  ])
})

Deno.test('a busy recovery lease rejects before the GitHub action starts', async () => {
  let actionCalled = false
  await rejects(
    () =>
      withRecoveryFloorLease(
        client(() => Promise.resolve({ data: false, error: null })),
        () => {
          actionCalled = true
          return Promise.resolve()
        },
        OWNER,
      ),
    RecoveryLeaseUnavailableError,
  )
  equal(actionCalled, false)
})

Deno.test(
  'the recovery lease releases after action failure without masking the error',
  async () => {
    let calls = 0
    const expected = new Error('GitHub unavailable')
    await rejects(
      () =>
        withRecoveryFloorLease(
          client(() => {
            calls += 1
            return Promise.resolve({ data: true, error: null })
          }),
          () => Promise.reject(expected),
          OWNER,
        ),
      expected,
    )
    equal(calls, 2)
  },
)

Deno.test('a release transport failure does not undo a completed critical section', async () => {
  let calls = 0
  const result = await withRecoveryFloorLease(
    client(() => {
      calls += 1
      if (calls === 1) return Promise.resolve({ data: true, error: null })
      return Promise.reject(new Error('release failed'))
    }),
    () => Promise.resolve('recorded'),
    OWNER,
  )

  equal(result, 'recorded')
  equal(calls, 2)
})

Deno.test('a resolved release error does not mask a completed critical section', async () => {
  let calls = 0
  const result = await withRecoveryFloorLease(
    client(() => {
      calls += 1
      if (calls === 1) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({
        data: false,
        error: new Error('release rejected'),
      })
    }),
    () => Promise.resolve('completed'),
    OWNER,
  )

  equal(result, 'completed')
  equal(calls, 2)
})
