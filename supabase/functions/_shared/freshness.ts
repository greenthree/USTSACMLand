import type { PlatformId } from './adapters/index.ts'

const freshnessHours: Record<PlatformId, number> = {
  codeforces: 14,
  atcoder: 14,
  nowcoder: 14,
  luogu: 14,
  qoj: 192,
  xcpc_elo: 192,
}

export function freshnessDeadline(platform: PlatformId, fetchedAt: string): string {
  return new Date(Date.parse(fetchedAt) + freshnessHours[platform] * 60 * 60 * 1_000).toISOString()
}
