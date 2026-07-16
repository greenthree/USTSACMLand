import type { PlatformId } from '../_shared/adapters/index.ts'
import { PLATFORM_CONCURRENCY_LIMITS } from '../sync-member/retry.ts'

export interface SyncDispatchTarget {
  memberId: string
  platform: PlatformId
  jobId?: number
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export async function dispatchWithPlatformLimits<T>(
  targets: readonly SyncDispatchTarget[],
  dispatch: (target: SyncDispatchTarget) => Promise<T>,
  recover: (target: SyncDispatchTarget, error: unknown) => T | Promise<T>,
): Promise<T[]> {
  const results: T[] = []

  for (const platform of Object.keys(PLATFORM_CONCURRENCY_LIMITS) as PlatformId[]) {
    const platformTargets = targets.filter((target) => target.platform === platform)
    for (const batch of chunks(platformTargets, PLATFORM_CONCURRENCY_LIMITS[platform])) {
      results.push(
        ...(await Promise.all(
          batch.map(async (target) => {
            try {
              return await dispatch(target)
            } catch (error) {
              return await recover(target, error)
            }
          }),
        )),
      )
    }
  }

  return results
}
