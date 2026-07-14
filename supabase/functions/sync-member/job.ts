import type { PlatformId } from '../_shared/adapters/types.ts'

export interface SyncJobTarget {
  scope: 'account' | 'member'
  profile_id: string
  platform: PlatformId | null
  dedupe_key: string
  payload: { platforms: PlatformId[] }
}

export function buildSyncJobTarget(
  memberId: string,
  requestedPlatforms: PlatformId[] | undefined,
  syncedPlatforms: PlatformId[],
): SyncJobTarget {
  const singleRequestedPlatform = requestedPlatforms?.length === 1
  const singleSyncedPlatform = syncedPlatforms.length === 1

  if (singleRequestedPlatform && singleSyncedPlatform) {
    const platform = syncedPlatforms[0]
    return {
      scope: 'account',
      profile_id: memberId,
      platform,
      dedupe_key: `member:${memberId}`,
      payload: { platforms: [...syncedPlatforms] },
    }
  }

  return {
    scope: 'member',
    profile_id: memberId,
    platform: null,
    dedupe_key: `member:${memberId}`,
    payload: { platforms: [...syncedPlatforms] },
  }
}
