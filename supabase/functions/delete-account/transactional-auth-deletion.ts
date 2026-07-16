import { RecoveryLeaseUnavailableError } from './recovery-lease.ts'

interface RpcResult {
  data: unknown
  error: unknown
}

export interface TransactionalAuthDeletionClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>
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

export async function deleteAuthUserWithRecoveryLease(
  client: TransactionalAuthDeletionClient,
  ownerToken: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('delete_auth_user_with_recovery_lease', {
    p_owner_token: ownerToken,
    p_user_id: userId,
  })
  if (error) throw new Error('Transactional Auth deletion RPC failed')

  const result = parseResult(data)
  if (!result.leaseOwned) {
    throw new RecoveryLeaseUnavailableError(
      'Account-deletion recovery lease was lost before Auth deletion',
    )
  }
  return result.deleted
}
