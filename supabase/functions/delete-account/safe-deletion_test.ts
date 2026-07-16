// deno-lint-ignore-file require-await
import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import { type RecoveryLeaseClient, withRecoveryFloorLease } from './recovery-lease.ts'
import { deleteUserWithRecoveryFloor, type SafeDeletionDependencies } from './safe-deletion.ts'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OWNER = '10000000-0000-4000-8000-000000000001'

function leasedDependencies(
  calls: string[],
  overrides: Partial<SafeDeletionDependencies> = {},
  releaseRejects = false,
): SafeDeletionDependencies {
  const client: RecoveryLeaseClient = {
    rpc(name) {
      if (name === 'acquire_account_deletion_recovery_lease') {
        calls.push('lease:acquired')
        return Promise.resolve({ data: true, error: null })
      }
      if (name === 'renew_account_deletion_recovery_lease') {
        calls.push('lease:renewed')
        return Promise.resolve({ data: true, error: null })
      }
      calls.push('lease:released')
      if (releaseRejects) {
        return Promise.reject(new Error('release transport failed'))
      }
      return Promise.resolve({ data: true, error: null })
    },
  }

  return {
    withRecoveryLease: (action) => withRecoveryFloorLease(client, action, USER_ID, OWNER),
    async recordRecoveryFloor() {
      calls.push('floor:confirmed')
    },
    async deleteUser(userId) {
      equal(userId, USER_ID)
      calls.push('auth:deleted')
      return true
    },
    ...overrides,
  }
}

Deno.test(
  'safe account deletion keeps floor confirmation and Auth deletion inside one lease',
  async () => {
    const calls: string[] = []
    const result = await deleteUserWithRecoveryFloor(leasedDependencies(calls), USER_ID)

    equal(result, 'deleted')
    deepStrictEqual(calls, [
      'lease:acquired',
      'floor:confirmed',
      'lease:renewed',
      'auth:deleted',
      'lease:released',
    ])
  },
)

Deno.test('safe account deletion stops heartbeat before the final Auth transaction', async () => {
  const calls: string[] = []
  const result = await deleteUserWithRecoveryFloor(
    {
      withRecoveryLease: (action) =>
        action(
          async () => {
            calls.push('lease:renewed')
          },
          async () => {
            calls.push('heartbeat:stopped')
          },
        ),
      async recordRecoveryFloor() {
        calls.push('floor:confirmed')
      },
      async deleteUser() {
        calls.push('auth:deleted')
        return true
      },
    },
    USER_ID,
  )

  equal(result, 'deleted')
  deepStrictEqual(calls, ['floor:confirmed', 'lease:renewed', 'heartbeat:stopped', 'auth:deleted'])
})

Deno.test(
  'safe account deletion does not release the lease while Auth deletion is pending',
  async () => {
    const calls: string[] = []
    let resolveDeletion: ((deleted: boolean) => void) | undefined
    let markDeletionStarted: (() => void) | undefined
    const deletionStarted = new Promise<void>((resolve) => {
      markDeletionStarted = resolve
    })
    const pendingDeletion = new Promise<boolean>((resolve) => {
      resolveDeletion = resolve
    })
    const operation = deleteUserWithRecoveryFloor(
      leasedDependencies(calls, {
        deleteUser(userId) {
          equal(userId, USER_ID)
          calls.push('auth:started')
          markDeletionStarted?.()
          return pendingDeletion
        },
      }),
      USER_ID,
    )

    await deletionStarted
    deepStrictEqual(calls, ['lease:acquired', 'floor:confirmed', 'lease:renewed', 'auth:started'])
    resolveDeletion?.(true)
    equal(await operation, 'deleted')
    deepStrictEqual(calls, [
      'lease:acquired',
      'floor:confirmed',
      'lease:renewed',
      'auth:started',
      'lease:released',
    ])
  },
)

Deno.test('safe account deletion fails closed when the recovery lease is unavailable', async () => {
  let floorCount = 0
  let deletionCount = 0
  const result = await deleteUserWithRecoveryFloor(
    {
      withRecoveryLease: (action) =>
        withRecoveryFloorLease(
          {
            rpc() {
              return Promise.resolve({ data: false, error: null })
            },
          },
          action,
          USER_ID,
          OWNER,
        ),
      async recordRecoveryFloor() {
        floorCount += 1
      },
      async deleteUser() {
        deletionCount += 1
        return true
      },
    },
    USER_ID,
  )

  equal(result, 'recovery_unavailable')
  equal(floorCount, 0)
  equal(deletionCount, 0)
})

Deno.test('safe account deletion never calls Auth when floor confirmation fails', async () => {
  const calls: string[] = []
  let deletionCount = 0
  const result = await deleteUserWithRecoveryFloor(
    leasedDependencies(calls, {
      async recordRecoveryFloor() {
        calls.push('floor:failed')
        throw new Error('GitHub recovery floor unavailable')
      },
      async deleteUser() {
        deletionCount += 1
        return true
      },
    }),
    USER_ID,
  )

  equal(result, 'recovery_unavailable')
  equal(deletionCount, 0)
  deepStrictEqual(calls, ['lease:acquired', 'floor:failed', 'lease:released'])
})

Deno.test('safe account deletion never calls Auth when lease renewal fails', async () => {
  const calls: string[] = []
  let deletionCount = 0
  const result = await deleteUserWithRecoveryFloor(
    leasedDependencies(calls, {
      withRecoveryLease: (action) =>
        withRecoveryFloorLease(
          {
            rpc(name) {
              if (name === 'acquire_account_deletion_recovery_lease') {
                calls.push('lease:acquired')
                return Promise.resolve({ data: true, error: null })
              }
              if (name === 'renew_account_deletion_recovery_lease') {
                calls.push('lease:lost')
                return Promise.resolve({ data: false, error: null })
              }
              calls.push('lease:released')
              return Promise.resolve({ data: true, error: null })
            },
          },
          action,
          USER_ID,
          OWNER,
        ),
      async deleteUser() {
        deletionCount += 1
        return true
      },
    }),
    USER_ID,
  )

  equal(result, 'recovery_unavailable')
  equal(deletionCount, 0)
  deepStrictEqual(calls, ['lease:acquired', 'floor:confirmed', 'lease:lost', 'lease:released'])
})

Deno.test(
  'safe account deletion records the floor but reports an Auth deletion failure',
  async () => {
    const calls: string[] = []
    const result = await deleteUserWithRecoveryFloor(
      leasedDependencies(calls, {
        async deleteUser(userId) {
          equal(userId, USER_ID)
          calls.push('auth:failed')
          return false
        },
      }),
      USER_ID,
    )

    equal(result, 'deletion_failed')
    deepStrictEqual(calls, [
      'lease:acquired',
      'floor:confirmed',
      'lease:renewed',
      'auth:failed',
      'lease:released',
    ])
  },
)

Deno.test('a lease release failure does not mask a completed Auth deletion', async () => {
  const calls: string[] = []
  const result = await deleteUserWithRecoveryFloor(leasedDependencies(calls, {}, true), USER_ID)

  equal(result, 'deleted')
  deepStrictEqual(calls, [
    'lease:acquired',
    'floor:confirmed',
    'lease:renewed',
    'auth:deleted',
    'lease:released',
  ])
})

Deno.test('unexpected Auth transport errors remain observable after lease release', async () => {
  const calls: string[] = []
  const expected = new Error('Auth transport detail')
  await rejects(
    () =>
      deleteUserWithRecoveryFloor(
        leasedDependencies(calls, {
          async deleteUser() {
            calls.push('auth:threw')
            throw expected
          },
        }),
        USER_ID,
      ),
    expected,
  )
  deepStrictEqual(calls, [
    'lease:acquired',
    'floor:confirmed',
    'lease:renewed',
    'auth:threw',
    'lease:released',
  ])
})
