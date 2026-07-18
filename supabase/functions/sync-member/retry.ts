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
  if (platforms.length !== 1 || platforms[0] === 'qoj') return 1
  return 3
}

export function mayAutomaticallyRetryPlatformFailure(
  platform: PlatformId,
  retryable: boolean,
): boolean {
  return platform !== 'qoj' && retryable
}
