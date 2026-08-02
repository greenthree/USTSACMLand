import { ratingPlatforms, solvedPlatforms } from './platforms'
import type { Member, RatingPlatform } from '../types/domain'

export type RatingBenchmarks = Record<RatingPlatform, number | null>

type RatingMetric = 'rating' | 'peakRating' | 'previousRating'

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

export function calculatePreviousRatingBenchmarks(members: Member[]): RatingBenchmarks {
  return calculateRatingBenchmarksByMetric(members, 'previousRating')
}

function calculateOverallRatingByMetric(
  member: Member,
  benchmarks: RatingBenchmarks,
  metric: RatingMetric,
): number | null {
  const normalizedRatings = ratingPlatforms.flatMap((platform) => {
    const rating = member.stats[platform][metric]
    const benchmark = benchmarks[platform]
    return rating === null || benchmark === null || benchmark <= 0 ? [] : [rating / benchmark]
  })
  if (normalizedRatings.length === 0) return null

  const normalizedAverage =
    normalizedRatings.reduce((sum, rating) => sum + rating, 0) / normalizedRatings.length
  const coverageFactor = Math.sqrt(normalizedRatings.length / ratingPlatforms.length)
  return 400 * ratingPlatforms.length * normalizedAverage * coverageFactor
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

export function calculateOverallPreviousRating(
  member: Member,
  benchmarks: RatingBenchmarks,
): number | null {
  return calculateOverallRatingByMetric(member, benchmarks, 'previousRating')
}

export function calculateOverallRankChanges(
  currentRankedMembers: Member[],
  currentBenchmarks: RatingBenchmarks,
  previousBenchmarks: RatingBenchmarks,
): Map<string, number | null> {
  const previousRankedMembers = currentRankedMembers
    .filter((member) => calculateOverallPreviousRating(member, previousBenchmarks) !== null)
    .sort((left, right) => {
      const leftValue = calculateOverallPreviousRating(left, previousBenchmarks) ?? -1
      const rightValue = calculateOverallPreviousRating(right, previousBenchmarks) ?? -1
      const valueDifference = rightValue - leftValue
      return valueDifference === 0 ? left.name.localeCompare(right.name, 'zh-CN') : valueDifference
    })
  const previousRanks = new Map(
    previousRankedMembers.map((member, index) => [member.id, index + 1]),
  )

  return new Map(
    currentRankedMembers.map((member, index) => {
      const previousRank = previousRanks.get(member.id)
      const currentValue = calculateOverallRating(member, currentBenchmarks)
      return [
        member.id,
        previousRank === undefined || currentValue === null ? null : previousRank - (index + 1),
      ]
    }),
  )
}

export function calculateTotalSolved(member: Member): number | null {
  const hasSolvedCount = solvedPlatforms.some((platform) => member.stats[platform].solved !== null)
  if (!hasSolvedCount) return null
  return solvedPlatforms.reduce((sum, platform) => sum + (member.stats[platform].solved ?? 0), 0)
}
