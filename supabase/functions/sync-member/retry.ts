import type { PlatformId } from '../_shared/adapters/index.ts'

export const PLATFORM_CONCURRENCY_LIMITS: Readonly<Record<PlatformId, number>> = {
  codeforces: 2,
  nowcoder: 1,
  atcoder: 2,
  xcpc_elo: 4,
  luogu: 1,
  qoj: 1,
}

export function maxAttemptsForPlatforms(platforms: readonly PlatformId[]): number {
  return platforms.length === 1 ? 2 : 1
}

export function mayAutomaticallyRetryPlatformFailure(
  _platform: PlatformId,
  retryable: boolean,
): boolean {
  return retryable
}
