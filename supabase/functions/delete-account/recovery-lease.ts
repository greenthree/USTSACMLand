export class RecoveryLeaseUnavailableError extends Error {}

interface RpcResult {
  data: unknown
  error: unknown
}

export interface RecoveryLeaseClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>
}

export interface RecoveryLeaseOptions {
  heartbeatIntervalMs?: number
  reportHeartbeatFailure?(error: unknown): Promise<void> | void
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000

export async function withRecoveryFloorLease<T>(
  client: RecoveryLeaseClient,
  action: (renew: () => Promise<void>) => Promise<T>,
  ownerToken = crypto.randomUUID(),
  options: RecoveryLeaseOptions = {},
): Promise<T> {
  let acquisition: RpcResult
  try {
    acquisition = await client.rpc('acquire_account_deletion_recovery_lease', {
      p_owner_token: ownerToken,
    })
  } catch {
    throw new RecoveryLeaseUnavailableError('Account-deletion recovery lease is unavailable')
  }
  const { data, error } = acquisition
  if (error || data !== true) {
    throw new RecoveryLeaseUnavailableError('Account-deletion recovery lease is unavailable')
  }

  const renew = async () => {
    let renewal: RpcResult
    try {
      renewal = await client.rpc('renew_account_deletion_recovery_lease', {
        p_owner_token: ownerToken,
      })
    } catch {
      throw new RecoveryLeaseUnavailableError('Account-deletion recovery lease was lost')
    }
    if (renewal.error || renewal.data !== true) {
      throw new RecoveryLeaseUnavailableError('Account-deletion recovery lease was lost')
    }
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatInFlight: Promise<void> | null = null
  let heartbeatStopped = false

  if (Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (heartbeatStopped || heartbeatInFlight) return
      heartbeatInFlight = renew()
        .catch(async (error: unknown) => {
          heartbeatStopped = true
          if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
          await options.reportHeartbeatFailure?.(error)
        })
        .finally(() => {
          heartbeatInFlight = null
        })
    }, heartbeatIntervalMs)
  }

  try {
    return await action(renew)
  } finally {
    heartbeatStopped = true
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    if (heartbeatInFlight) await heartbeatInFlight
    try {
      await client.rpc('release_account_deletion_recovery_lease', {
        p_owner_token: ownerToken,
      })
    } catch {
      // The database lease expires automatically. Release failures must not
      // hide a completed recovery-floor record or the original action error.
    }
  }
}
