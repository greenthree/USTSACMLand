import { ratingPlatforms, solvedPlatforms } from './platforms'
import type { Member, RatingPlatform } from '../types/domain'

export type RatingBenchmarks = Record<RatingPlatform, number | null>

export function calculateRatingBenchmarks(members: Member[]): RatingBenchmarks {
  return Object.fromEntries(
    ratingPlatforms.map((platform) => {
      const values = members
        .flatMap((member) => {
          const value = member.stats[platform].rating
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

export function calculateOverallRating(
  member: Member,
  benchmarks: RatingBenchmarks,
): number | null {
  const hasRating = ratingPlatforms.some((platform) => member.stats[platform].rating !== null)
  if (!hasRating) return null

  const normalizedSum = ratingPlatforms.reduce((sum, platform) => {
    const rating = member.stats[platform].rating
    const benchmark = benchmarks[platform]
    if (rating === null || benchmark === null || benchmark <= 0) return sum
    return sum + rating / benchmark
  }, 0)

  return 400 * normalizedSum
}

export function calculateTotalSolved(member: Member): number | null {
  const hasSolvedCount = solvedPlatforms.some((platform) => member.stats[platform].solved !== null)
  if (!hasSolvedCount) return null
  return solvedPlatforms.reduce((sum, platform) => sum + (member.stats[platform].solved ?? 0), 0)
}
