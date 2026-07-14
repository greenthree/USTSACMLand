import { ratingPlatforms, solvedPlatforms } from './platforms'
import type { Member, RatingPlatform } from '../types/domain'

export type RatingBenchmarks = Record<RatingPlatform, number | null>

type RatingMetric = 'rating' | 'peakRating'

function calculateRatingBenchmarksByMetric(
  members: Member[],
  metric: RatingMetric,
): RatingBenchmarks {
  return Object.fromEntries(
    ratingPlatforms.map((platform) => {
      const values = members
        .flatMap((member) => {
          const value = member.stats[platform][metric]
          return value === null ? [] : [value]
        })
        .sort((left, right) => right - left)
        .slice(0, 5)
      const average =
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
      return [platform, average]
    }),
  ) as RatingBenchmarks
}

export function calculateRatingBenchmarks(members: Member[]): RatingBenchmarks {
  return calculateRatingBenchmarksByMetric(members, 'rating')
}

export function calculatePeakRatingBenchmarks(members: Member[]): RatingBenchmarks {
  return calculateRatingBenchmarksByMetric(members, 'peakRating')
}

function calculateOverallRatingByMetric(
  member: Member,
  benchmarks: RatingBenchmarks,
  metric: RatingMetric,
): number | null {
  const hasMetric = ratingPlatforms.some((platform) => member.stats[platform][metric] !== null)
  if (!hasMetric) return null

  const normalizedSum = ratingPlatforms.reduce((sum, platform) => {
    const rating = member.stats[platform][metric]
    const benchmark = benchmarks[platform]
    if (rating === null || benchmark === null || benchmark <= 0) return sum
    return sum + rating / benchmark
  }, 0)

  return 400 * normalizedSum
}

export function calculateOverallRating(
  member: Member,
  benchmarks: RatingBenchmarks,
): number | null {
  return calculateOverallRatingByMetric(member, benchmarks, 'rating')
}

export function calculateOverallPeakRating(
  member: Member,
  benchmarks: RatingBenchmarks,
): number | null {
  return calculateOverallRatingByMetric(member, benchmarks, 'peakRating')
}

export function calculateTotalSolved(member: Member): number | null {
  const hasSolvedCount = solvedPlatforms.some((platform) => member.stats[platform].solved !== null)
  if (!hasSolvedCount) return null
  return solvedPlatforms.reduce((sum, platform) => sum + (member.stats[platform].solved ?? 0), 0)
}
