import { equal, rejects } from 'node:assert/strict'
import { RecoveryLeaseUnavailableError } from './recovery-lease.ts'
import {
  deleteAuthUserWithRecoveryLease,
  type TransactionalAuthDeletionClient,
} from './transactional-auth-deletion.ts'

const OWNER = '10000000-0000-4000-8000-000000000001'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function client(data: unknown, error: unknown = null): TransactionalAuthDeletionClient {
  return {
    rpc(name, args) {
      equal(name, 'delete_auth_user_with_recovery_lease')
      equal(args.p_owner_token, OWNER)
      equal(args.p_user_id, USER_ID)
      return Promise.resolve({ data, error })
    },
  }
}

Deno.test('transactional Auth deletion returns the committed deletion result', async () => {
  equal(
    await deleteAuthUserWithRecoveryLease(
      client({ leaseOwned: true, deleted: true }),
      OWNER,
      USER_ID,
    ),
    true,
  )
  equal(
    await deleteAuthUserWithRecoveryLease(
      client({ leaseOwned: true, deleted: false }),
      OWNER,
      USER_ID,
    ),
    false,
  )
})

Deno.test('transactional Auth deletion fails closed after lease ownership is lost', async () => {
  await rejects(
    () =>
      deleteAuthUserWithRecoveryLease(
        client({ leaseOwned: false, deleted: false }),
        OWNER,
        USER_ID,
      ),
    RecoveryLeaseUnavailableError,
  )
})

Deno.test('transactional Auth deletion rejects RPC and response-contract failures', async () => {
  await rejects(
    () => deleteAuthUserWithRecoveryLease(client(null, new Error('database')), OWNER, USER_ID),
    /RPC failed/,
  )
  await rejects(
    () => deleteAuthUserWithRecoveryLease(client(null), OWNER, USER_ID),
    /invalid response/,
  )
  await rejects(
    () => deleteAuthUserWithRecoveryLease(client({ leaseOwned: true }), OWNER, USER_ID),
    /invalid fields/,
  )
})
