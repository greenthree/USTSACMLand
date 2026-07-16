import type { AdapterResult, PlatformId } from '../_shared/adapters/index.ts'

export const PLATFORM_CONCURRENCY_LIMITS: Readonly<Record<PlatformId, number>> = {
  codeforces: 2,
  nowcoder: 1,
  atcoder: 2,
  xcpc_elo: 4,
  luogu: 1,
  qoj: 1,
}

const RETRY_BASE_DELAY_MS = 2 * 60 * 1_000
const RETRY_MAX_DELAY_MS = 30 * 60 * 1_000

export function maxAttemptsForPlatforms(platforms: readonly PlatformId[]): number {
  if (platforms.length !== 1 || platforms[0] === 'qoj') return 1
  return 3
}

export function nextRetryAt(
  platforms: readonly PlatformId[],
  results: readonly AdapterResult[],
  completedAttempt: number,
  now = new Date(),
): string | null {
  const maxAttempts = maxAttemptsForPlatforms(platforms)
  if (completedAttempt < 1 || completedAttempt >= maxAttempts) return null
  if (results.length !== 1 || results[0].ok || !results[0].error.retryable) return null

  const delay = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** Math.max(0, completedAttempt - 1),
    RETRY_MAX_DELAY_MS,
  )
  return new Date(now.getTime() + delay).toISOString()
}
