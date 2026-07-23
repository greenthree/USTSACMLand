import { equal, rejects } from 'node:assert/strict'
import { RecoveryLeaseUnavailableError } from './recovery-lease.ts'
import {
  deleteAuthUserWithRecoveryLease,
  type TransactionalAuthDeletionClient,
} from './transactional-auth-deletion.ts'

const OWNER = '10000000-0000-4000-8000-000000000001'
const USER_ID = '11111111-1111-4111-8111-111111111111'

interface ClientOptions {
  rpcData?: unknown
  rpcError?: unknown
  rpcThrows?: unknown
  authUser?: unknown
  authError?: unknown
  authThrows?: unknown
  profile?: unknown
  profileError?: unknown
  profileThrows?: unknown
}

function client({
  rpcData = { leaseOwned: true, deleted: true },
  rpcError = null,
  rpcThrows,
  authUser = { id: USER_ID },
  authError = null,
  authThrows,
  profile = { id: USER_ID },
  profileError = null,
  profileThrows,
}: ClientOptions = {}): TransactionalAuthDeletionClient {
  return {
    rpc(name, args) {
      equal(name, 'delete_auth_user_with_recovery_lease')
      equal(args.p_owner_token, OWNER)
      equal(args.p_user_id, USER_ID)
      if (rpcThrows !== undefined) return Promise.reject(rpcThrows)
      return Promise.resolve({ data: rpcData, error: rpcError })
    },
    auth: {
      admin: {
        getUserById(userId) {
          equal(userId, USER_ID)
          if (authThrows !== undefined) return Promise.reject(authThrows)
          return Promise.resolve({ data: { user: authUser }, error: authError })
        },
      },
    },
    from(table) {
      equal(table, 'profiles')
      return {
        select(columns: string) {
          equal(columns, 'id')
          return {
            eq(column: string, value: string) {
              equal(column, 'id')
              equal(value, USER_ID)
              return {
                maybeSingle() {
                  if (profileThrows !== undefined) return Promise.reject(profileThrows)
                  return Promise.resolve({ data: profile, error: profileError })
                },
              }
            },
          }
        },
      }
    },
  }
}

Deno.test('transactional Auth deletion returns the committed deletion result', async () => {
  equal(
    await deleteAuthUserWithRecoveryLease(
      client({ rpcData: { leaseOwned: true, deleted: true } }),
      OWNER,
      USER_ID,
    ),
    true,
  )
  equal(
    await deleteAuthUserWithRecoveryLease(
      client({ rpcData: { leaseOwned: true, deleted: false } }),
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
        client({ rpcData: { leaseOwned: false, deleted: false } }),
        OWNER,
        USER_ID,
      ),
    RecoveryLeaseUnavailableError,
  )
})

Deno.test('transactional Auth deletion rejects RPC and response-contract failures', async () => {
  const databaseError = new Error('database')
  await rejects(
    () =>
      deleteAuthUserWithRecoveryLease(
        client({ rpcData: null, rpcError: databaseError }),
        OWNER,
        USER_ID,
      ),
    (error) => error === databaseError,
  )
  await rejects(
    () => deleteAuthUserWithRecoveryLease(client({ rpcData: null }), OWNER, USER_ID),
    /invalid response/,
  )
  await rejects(
    () =>
      deleteAuthUserWithRecoveryLease(client({ rpcData: { leaseOwned: true } }), OWNER, USER_ID),
    /invalid fields/,
  )
})

Deno.test(
  'transactional Auth deletion accepts a committed deletion after its response is lost',
  async () => {
    const responseLost = new Error('response lost')
    equal(
      await deleteAuthUserWithRecoveryLease(
        client({ rpcThrows: responseLost, authUser: null, profile: null }),
        OWNER,
        USER_ID,
      ),
      true,
    )

    equal(
      await deleteAuthUserWithRecoveryLease(
        client({
          rpcError: new Error('connection closed before response'),
          authError: { code: 'user_not_found', status: 404 },
          profile: null,
        }),
        OWNER,
        USER_ID,
      ),
      true,
    )
  },
)

Deno.test(
  'transactional Auth deletion preserves the RPC error when the transaction did not commit',
  async () => {
    const responseLost = new Error('response lost before commit')
    await rejects(
      () => deleteAuthUserWithRecoveryLease(client({ rpcThrows: responseLost }), OWNER, USER_ID),
      (error) => error === responseLost,
    )
  },
)

Deno.test(
  'transactional Auth deletion fails closed when Auth and profile state are split',
  async () => {
    const authRemains = new Error('Auth still exists')
    await rejects(
      () =>
        deleteAuthUserWithRecoveryLease(
          client({ rpcThrows: authRemains, profile: null }),
          OWNER,
          USER_ID,
        ),
      (error) => error === authRemains,
    )

    const profileRemains = new Error('profile still exists')
    await rejects(
      () =>
        deleteAuthUserWithRecoveryLease(
          client({ rpcThrows: profileRemains, authUser: null }),
          OWNER,
          USER_ID,
        ),
      (error) => error === profileRemains,
    )
  },
)

Deno.test(
  'transactional Auth deletion fails closed when reconciliation cannot be read',
  async () => {
    const authReadFailure = new Error('original Auth reconciliation RPC error')
    await rejects(
      () =>
        deleteAuthUserWithRecoveryLease(
          client({
            rpcThrows: authReadFailure,
            authUser: null,
            authThrows: new Error('Auth lookup unavailable'),
            profile: null,
          }),
          OWNER,
          USER_ID,
        ),
      (error) => error === authReadFailure,
    )

    const profileReadFailure = new Error('original profile reconciliation RPC error')
    await rejects(
      () =>
        deleteAuthUserWithRecoveryLease(
          client({
            rpcThrows: profileReadFailure,
            authUser: null,
            profile: null,
            profileError: new Error('profile lookup unavailable'),
          }),
          OWNER,
          USER_ID,
        ),
      (error) => error === profileReadFailure,
    )

    const ambiguousAuthNotFound = new Error('original ambiguous Auth RPC error')
    await rejects(
      () =>
        deleteAuthUserWithRecoveryLease(
          client({
            rpcThrows: ambiguousAuthNotFound,
            authError: { status: 404 },
            profile: null,
          }),
          OWNER,
          USER_ID,
        ),
      (error) => error === ambiguousAuthNotFound,
    )
  },
)
