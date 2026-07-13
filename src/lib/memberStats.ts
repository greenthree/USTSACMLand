import type { Platform, SyncStatus } from '../types/domain'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS
const dailyPlatforms = new Set<Platform>(['codeforces', 'nowcoder', 'luogu', 'atcoder'])

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

export function scheduledFreshnessDeadline(
  platform: Platform,
  lastSuccessAt: string | null,
): number | null {
  if (!lastSuccessAt) return null
  const timestamp = Date.parse(lastSuccessAt)
  if (!Number.isFinite(timestamp)) return null
  return dailyPlatforms.has(platform)
    ? nextDailySyncAfter(timestamp) + 2 * HOUR_MS
    : nextWeeklySyncAfter(timestamp) + DAY_MS
}

export function mapPublicStatStatus(
  status: string,
  platform: Platform,
  lastSuccessAt: string | null,
  now = Date.now(),
): SyncStatus {
  if (status === 'syncing') return 'syncing'
  if (status === 'fresh' || status === 'stale') {
    const deadline = scheduledFreshnessDeadline(platform, lastSuccessAt)
    if (deadline === null) return 'error'
    return deadline <= now ? 'stale' : 'fresh'
  }
  return 'error'
}
