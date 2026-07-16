import { RecoveryLeaseUnavailableError } from './recovery-lease.ts'

export type SafeDeletionResult = 'deleted' | 'recovery_unavailable' | 'deletion_failed'

export interface SafeDeletionDependencies {
  withRecoveryLease<T>(
    action: (renew: () => Promise<void>, stopHeartbeat: () => Promise<void>) => Promise<T>,
  ): Promise<T>
  recordRecoveryFloor(): Promise<void>
  deleteUser(userId: string): Promise<boolean>
}

export async function deleteUserWithRecoveryFloor(
  dependencies: SafeDeletionDependencies,
  userId: string,
): Promise<SafeDeletionResult> {
  try {
    return await dependencies.withRecoveryLease(async (renew, stopHeartbeat) => {
      try {
        await dependencies.recordRecoveryFloor()
        await renew()
        await stopHeartbeat()
      } catch {
        return 'recovery_unavailable'
      }

      return (await dependencies.deleteUser(userId)) ? 'deleted' : 'deletion_failed'
    })
  } catch (error) {
    if (error instanceof RecoveryLeaseUnavailableError) {
      return 'recovery_unavailable'
    }
    throw error
  }
}
