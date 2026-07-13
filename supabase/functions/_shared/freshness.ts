import type { PlatformId } from './adapters/index.ts'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS
const DAILY_PLATFORMS = new Set<PlatformId>(['codeforces', 'nowcoder', 'luogu', 'atcoder'])

function parsedTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('Invalid successful synchronization timestamp')
  return timestamp
}

function shanghaiDayStart(timestamp: number): number {
  const local = new Date(timestamp + SHANGHAI_OFFSET_MS)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
}

function nextDailySyncAfter(timestamp: number): number {
  const dayStart = shanghaiDayStart(timestamp)
  for (const hour of [7, 19]) {
    const candidate = dayStart + hour * HOUR_MS - SHANGHAI_OFFSET_MS
    if (candidate > timestamp) return candidate
  }
  return dayStart + DAY_MS + 7 * HOUR_MS - SHANGHAI_OFFSET_MS
}

function nextWeeklySyncAfter(timestamp: number): number {
  const local = new Date(timestamp + SHANGHAI_OFFSET_MS)
  const dayStart = shanghaiDayStart(timestamp)
  const daysUntilTuesday = (2 - local.getUTCDay() + 7) % 7
  let candidate = dayStart + daysUntilTuesday * DAY_MS + 8 * HOUR_MS - SHANGHAI_OFFSET_MS
  if (candidate <= timestamp) candidate += 7 * DAY_MS
  return candidate
}

export function freshnessDeadline(platform: PlatformId, successfulAt: string): string {
  const timestamp = parsedTimestamp(successfulAt)
  const deadline = DAILY_PLATFORMS.has(platform)
    ? nextDailySyncAfter(timestamp) + 2 * HOUR_MS
    : nextWeeklySyncAfter(timestamp) + DAY_MS
  return new Date(deadline).toISOString()
}

export function retainedFreshness(
  platform: PlatformId,
  lastSuccessAt: string | null,
  now = Date.now(),
): { status: 'fresh' | 'stale' | 'unavailable'; staleAfter: string | null } {
  if (!lastSuccessAt) return { status: 'unavailable', staleAfter: null }
  const staleAfter = freshnessDeadline(platform, lastSuccessAt)
  return {
    status: Date.parse(staleAfter) <= now ? 'stale' : 'fresh',
    staleAfter,
  }
}
