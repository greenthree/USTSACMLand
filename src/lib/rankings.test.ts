import { mockMembers } from '../data/mock'
import type { Member } from '../types/domain'
import { calculateOverallRating, calculateRatingBenchmarks, calculateTotalSolved } from './rankings'

describe('overall rankings', () => {
  it('uses the top five Codeforces members as rating benchmarks', () => {
    const benchmarks = calculateRatingBenchmarks(mockMembers)

    expect(benchmarks).toEqual({
      codeforces: 1700,
      nowcoder: 1701.4,
      atcoder: 1473.6,
      xcpc_elo: 1678.2,
    })
    expect(calculateOverallRating(mockMembers[0], benchmarks)).toBeCloseTo(1752.41, 2)
    expect(calculateOverallRating(mockMembers[5], benchmarks)).toBeCloseTo(921.23, 2)
  })

  it('sums solved counts across the four supported platforms', () => {
    expect(calculateTotalSolved(mockMembers[0])).toBe(3098)
    expect(calculateTotalSolved(mockMembers[1])).toBe(3563)
    expect(calculateTotalSolved(mockMembers[4])).toBe(2186)
  })

  it('returns no aggregate when a member has no applicable data', () => {
    const member = structuredClone(mockMembers[0]) as Member
    for (const stat of Object.values(member.stats)) {
      stat.rating = null
      stat.solved = null
    }

    const benchmarks = calculateRatingBenchmarks(mockMembers)
    expect(calculateOverallRating(member, benchmarks)).toBeNull()
    expect(calculateTotalSolved(member)).toBeNull()
  })
})
