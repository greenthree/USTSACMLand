import { ratingPlatforms } from './platforms'
import { supabase } from './supabase'
import type { Member, Platform, RatingPlatform, RatingSnapshot } from '../types/domain'

interface PublicRatingSnapshotRow {
  id: number | null
  platform: Platform | null
  current_rating: number | null
  max_rating: number | null
  recorded_at: string | null
  source_observed_at: string | null
  status: string | null
}

export interface RatingTrendPoint extends RatingSnapshot {
  x: number
  y: number
}

export interface RatingTrendChartData {
  points: RatingTrendPoint[]
  minimum: number
  maximum: number
  yTicks: Array<{ value: number; y: number }>
}

const ratingPlatformSet = new Set<Platform>(ratingPlatforms)
const demoDates = [
  '2026-02-01T12:00:00+08:00',
  '2026-03-01T12:00:00+08:00',
  '2026-04-01T12:00:00+08:00',
  '2026-05-01T12:00:00+08:00',
  '2026-06-01T12:00:00+08:00',
  '2026-07-12T18:20:00+08:00',
]

function isRatingPlatform(platform: Platform | null): platform is RatingPlatform {
  return platform !== null && ratingPlatformSet.has(platform)
}

export function mapPublicRatingSnapshots(rows: PublicRatingSnapshotRow[]): RatingSnapshot[] {
  const snapshots = rows.flatMap((row) => {
    if (
      !isRatingPlatform(row.platform) ||
      row.current_rating === null ||
      !Number.isFinite(row.current_rating) ||
      row.current_rating < 0 ||
      !row.recorded_at ||
      Number.isNaN(Date.parse(row.recorded_at)) ||
      row.status !== 'fresh'
    ) {
      return []
    }

    return [
      {
        id: row.id,
        platform: row.platform,
        rating: row.current_rating,
        peakRating: row.max_rating,
        recordedAt: row.recorded_at,
        sourceObservedAt:
          row.source_observed_at && !Number.isNaN(Date.parse(row.source_observed_at))
            ? row.source_observed_at
            : null,
      },
    ]
  })

  snapshots.sort(
    (left, right) =>
      Date.parse(left.sourceObservedAt ?? left.recordedAt) -
      Date.parse(right.sourceObservedAt ?? right.recordedAt),
  )

  const retained: RatingSnapshot[] = []
  for (const platform of ratingPlatforms) {
    const platformRows = snapshots.filter((snapshot) => snapshot.platform === platform)
    const observedTimeIndexes = new Map<string, number>()
    const deduplicated: RatingSnapshot[] = []
    for (const snapshot of platformRows) {
      if (snapshot.sourceObservedAt) {
        const existingIndex = observedTimeIndexes.get(snapshot.sourceObservedAt)
        if (existingIndex !== undefined) {
          if (
            Date.parse(snapshot.recordedAt) > Date.parse(deduplicated[existingIndex].recordedAt)
          ) {
            deduplicated[existingIndex] = snapshot
          }
          continue
        }
        observedTimeIndexes.set(snapshot.sourceObservedAt, deduplicated.length)
      }
      deduplicated.push(snapshot)
    }
    retained.push(...deduplicated.slice(-100))
  }
  retained.sort(
    (left, right) =>
      Date.parse(left.sourceObservedAt ?? left.recordedAt) -
      Date.parse(right.sourceObservedAt ?? right.recordedAt),
  )
  return retained
}

export async function fetchPublicRatingSnapshots(profileId: string): Promise<RatingSnapshot[]> {
  const client = supabase
  if (!client) return []

  const results = await Promise.all(
    ratingPlatforms.map((platform) =>
      client
        .from('public_stat_snapshots')
        .select('id, platform, current_rating, max_rating, recorded_at, source_observed_at, status')
        .eq('profile_id', profileId)
        .eq('platform', platform)
        .eq('status', 'fresh')
        .not('current_rating', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(200),
    ),
  )

  const firstError = results.find((result) => result.error)?.error
  if (firstError) throw new Error(`Rating 历史读取失败：${firstError.message}`)
  return mapPublicRatingSnapshots(
    results.flatMap((result) => (result.data ?? []) as PublicRatingSnapshotRow[]),
  )
}

export function buildDemoRatingSnapshots(member: Member): RatingSnapshot[] {
  return ratingPlatforms.flatMap((platform) => {
    const current = member.stats[platform].rating
    if (current === null) return []
    const peak = Math.max(current, member.stats[platform].peakRating ?? current)
    const values = [
      Math.max(0, Math.round(current * 0.78)),
      Math.max(0, Math.round(current * 0.84)),
      Math.max(0, Math.round(current * 0.88)),
      Math.max(0, Math.round(current * 0.93)),
      peak,
      current,
    ]
    return values.map((rating, index) => ({
      id: -(ratingPlatforms.indexOf(platform) * 10 + index + 1),
      platform,
      rating,
      peakRating: Math.max(...values.slice(0, index + 1)),
      recordedAt: demoDates[index],
      sourceObservedAt: demoDates[index],
    }))
  })
}

export function buildRatingTrendChartData(snapshots: RatingSnapshot[]): RatingTrendChartData {
  if (snapshots.length === 0) throw new Error('Rating trend requires at least one snapshot.')
  const sorted = [...snapshots].sort(
    (left, right) =>
      Date.parse(left.sourceObservedAt ?? left.recordedAt) -
      Date.parse(right.sourceObservedAt ?? right.recordedAt),
  )
  const ratings = sorted.map((snapshot) => snapshot.rating)
  const rawMinimum = Math.min(...ratings)
  const rawMaximum = Math.max(...ratings)
  const rawRange = rawMaximum - rawMinimum
  const padding = Math.max(50, Math.round((rawRange || Math.max(rawMaximum, 100)) * 0.12))
  const minimum = Math.max(0, Math.floor((rawMinimum - padding) / 50) * 50)
  const maximum = Math.max(minimum + 100, Math.ceil((rawMaximum + padding) / 50) * 50)
  const xStart = 70
  const xEnd = 780
  const yStart = 24
  const yEnd = 188
  const xRange = xEnd - xStart
  const yRange = yEnd - yStart
  const times = sorted.map((snapshot) =>
    Date.parse(snapshot.sourceObservedAt ?? snapshot.recordedAt),
  )
  const firstTime = Math.min(...times)
  const lastTime = Math.max(...times)
  const timeRange = lastTime - firstTime

  const points = sorted.map((snapshot, index) => ({
    ...snapshot,
    x:
      timeRange === 0
        ? xStart + xRange / 2
        : xStart + ((times[index] - firstTime) / timeRange) * xRange,
    y: yEnd - ((snapshot.rating - minimum) / (maximum - minimum)) * yRange,
  }))

  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    return {
      value: Math.round(maximum - ratio * (maximum - minimum)),
      y: yStart + ratio * yRange,
    }
  })

  return { points, minimum: rawMinimum, maximum: rawMaximum, yTicks }
}
