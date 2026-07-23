import { RecoveryLeaseUnavailableError } from './recovery-lease.ts'

interface RpcResult {
  data: unknown
  error: unknown
}

interface AuthUserLookupResult {
  data: { user: unknown } | null
  error: unknown
}

interface ProfileLookupResult {
  data: unknown
  error: unknown
}

interface ProfileLookupBuilder {
  eq(
    column: string,
    value: string,
  ): {
    maybeSingle(): PromiseLike<ProfileLookupResult>
  }
}

export interface TransactionalAuthDeletionClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>
  auth: {
    admin: {
      getUserById(userId: string): PromiseLike<AuthUserLookupResult>
    }
  }
  from(table: string): unknown
}

interface TransactionalDeletionResult {
  leaseOwned: boolean
  deleted: boolean
}

function parseResult(value: unknown): TransactionalDeletionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transactional Auth deletion returned an invalid response')
  }
  const row = value as Record<string, unknown>
  if (typeof row.leaseOwned !== 'boolean' || typeof row.deleted !== 'boolean') {
    throw new Error('Transactional Auth deletion returned invalid fields')
  }
  return { leaseOwned: row.leaseOwned, deleted: row.deleted }
}

function isAuthUserNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const authError = error as Record<string, unknown>
  return authError.code === 'user_not_found'
}

async function authUserIsConfirmedAbsent(
  client: TransactionalAuthDeletionClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client.auth.admin.getUserById(userId)
    if (error) return isAuthUserNotFound(error)
    return data !== null && data.user === null
  } catch {
    return false
  }
}

async function profileIsConfirmedAbsent(
  client: TransactionalAuthDeletionClient,
  userId: string,
): Promise<boolean> {
  try {
    const profiles = client.from('profiles') as {
      select(columns: string): ProfileLookupBuilder
    }
    const { data, error } = await profiles.select('id').eq('id', userId).maybeSingle()
    return !error && data === null
  } catch {
    return false
  }
}

async function deletionIsConfirmedCommitted(
  client: TransactionalAuthDeletionClient,
  userId: string,
): Promise<boolean> {
  const [authUserAbsent, profileAbsent] = await Promise.all([
    authUserIsConfirmedAbsent(client, userId),
    profileIsConfirmedAbsent(client, userId),
  ])
  return authUserAbsent && profileAbsent
}

async function reconcileOrThrow(
  client: TransactionalAuthDeletionClient,
  userId: string,
  originalError: unknown,
): Promise<true> {
  if (await deletionIsConfirmedCommitted(client, userId)) return true
  throw originalError
}

export async function deleteAuthUserWithRecoveryLease(
  client: TransactionalAuthDeletionClient,
  ownerToken: string,
  userId: string,
): Promise<boolean> {
  let response: RpcResult
  try {
    response = await client.rpc('delete_auth_user_with_recovery_lease', {
      p_owner_token: ownerToken,
      p_user_id: userId,
    })
  } catch (error) {
    return await reconcileOrThrow(client, userId, error)
  }

  if (response.error) {
    return await reconcileOrThrow(client, userId, response.error)
  }

  let result: TransactionalDeletionResult
  try {
    result = parseResult(response.data)
  } catch (error) {
    return await reconcileOrThrow(client, userId, error)
  }

  if (!result.leaseOwned) {
    throw new RecoveryLeaseUnavailableError(
      'Account-deletion recovery lease was lost before Auth deletion',
    )
  }
  return result.deleted
}
