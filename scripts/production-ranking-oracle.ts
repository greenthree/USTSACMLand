export const platforms = ['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo', 'luogu', 'qoj'] as const
export const ratingPlatforms = ['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo'] as const
export const solvedPlatforms = ['codeforces', 'nowcoder', 'atcoder', 'luogu', 'qoj'] as const

export type Platform = (typeof platforms)[number]
export type RatingPlatform = (typeof ratingPlatforms)[number]
export type RatingMetric = 'currentRating' | 'maxRating'
export type RatingBenchmarks = Record<RatingPlatform, number | null>

export interface PublicMemberRow {
  id: string
  full_name: string
  major: string
  grade: string
}

export interface PublicStatRow {
  profile_id: string
  platform: Platform
  current_rating: number | null
  max_rating: number | null
  solved_count: number | null
}

export interface ProductionMember extends PublicMemberRow {
  stats: Record<
    Platform,
    { currentRating: number | null; maxRating: number | null; solvedCount: number | null }
  >
}

export interface ExpectedRankingRow {
  id: string
  name: string
  primaryValue: string
  secondaryValue?: string
}

export function buildMembers(
  memberRows: PublicMemberRow[],
  statRows: PublicStatRow[],
): ProductionMember[] {
  const members = memberRows.map((member) => ({
    ...member,
    stats: Object.fromEntries(
      platforms.map((platform) => [
        platform,
        { currentRating: null, maxRating: null, solvedCount: null },
      ]),
    ) as ProductionMember['stats'],
  }))
  const memberById = new Map(members.map((member) => [member.id, member]))

  for (const stat of statRows) {
    const member = memberById.get(stat.profile_id)
    if (!member) continue
    member.stats[stat.platform] = {
      currentRating: stat.current_rating,
      maxRating: stat.max_rating,
      solvedCount: stat.solved_count,
    }
  }

  return members
}

export function calculateBenchmarks(
  members: ProductionMember[],
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
      return [
        platform,
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
      ]
    }),
  ) as RatingBenchmarks
}

export function calculateOverallRating(
  member: ProductionMember,
  benchmarks: RatingBenchmarks,
  metric: RatingMetric,
): number | null {
  if (!ratingPlatforms.some((platform) => member.stats[platform][metric] !== null)) return null

  const normalizedSum = ratingPlatforms.reduce((sum, platform) => {
    const value = member.stats[platform][metric]
    const benchmark = benchmarks[platform]
    if (value === null || benchmark === null || benchmark <= 0) return sum
    return sum + value / benchmark
  }, 0)
  return 400 * normalizedSum
}

export function calculateTotalSolved(member: ProductionMember): number | null {
  if (!solvedPlatforms.some((platform) => member.stats[platform].solvedCount !== null)) return null
  return solvedPlatforms.reduce(
    (sum, platform) => sum + (member.stats[platform].solvedCount ?? 0),
    0,
  )
}

export function sortMembers(
  members: ProductionMember[],
  getValue: (member: ProductionMember) => number | null,
) {
  return [...members].sort((left, right) => {
    const difference = (getValue(right) ?? -1) - (getValue(left) ?? -1)
    return difference === 0 ? left.full_name.localeCompare(right.full_name, 'zh-CN') : difference
  })
}

const integerFormatter = new Intl.NumberFormat('zh-CN')
const decimalFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatInteger(value: number | null) {
  return value === null ? '--' : integerFormatter.format(value)
}

export function formatDecimal(value: number | null) {
  return value === null ? '--' : decimalFormatter.format(value)
}

export function expectedRows(
  members: ProductionMember[],
  getValue: (member: ProductionMember) => number | null,
  formatter: (value: number | null) => string,
  getSecondaryValue?: (member: ProductionMember) => number | null,
): ExpectedRankingRow[] {
  return sortMembers(members, getValue).map((member) => ({
    id: member.id,
    name: member.full_name,
    primaryValue: formatter(getValue(member)),
    secondaryValue: getSecondaryValue ? formatter(getSecondaryValue(member)) : undefined,
  }))
}
