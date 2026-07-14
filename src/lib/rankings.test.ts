import { mockMembers } from '../data/mock'
import type { Member } from '../types/domain'
import {
  calculateOverallPeakRating,
  calculateOverallRating,
  calculatePeakRatingBenchmarks,
  calculateRatingBenchmarks,
  calculateTotalSolved,
} from './rankings'

describe('overall rankings', () => {
  it('uses each platform independent top five as its rating benchmark', () => {
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

  it('includes a low-Codeforces member when they rank in another platform top five', () => {
    const members = structuredClone(mockMembers) as Member[]
    members[5].stats.nowcoder.rating = 2500
    members[5].stats.atcoder.rating = 2500
    members[5].stats.xcpc_elo.rating = 2500

    expect(calculateRatingBenchmarks(members)).toEqual({
      codeforces: 1700,
      nowcoder: 1903,
      atcoder: 1716.4,
      xcpc_elo: 1877.4,
    })
  })

  it('uses historical maximum ratings for the peak overall benchmark and score', () => {
    const benchmarks = calculatePeakRatingBenchmarks(mockMembers)

    expect(benchmarks).toEqual({
      codeforces: 1762.4,
      nowcoder: 1744.2,
      atcoder: 1501.6,
      xcpc_elo: 1714.6,
    })
    expect(calculateOverallPeakRating(mockMembers[0], benchmarks)).toBeCloseTo(1771.35, 2)
  })

  it('sums solved counts across the five supported platforms', () => {
    expect(calculateTotalSolved(mockMembers[0])).toBe(3553)
    expect(calculateTotalSolved(mockMembers[1])).toBe(4165)
    expect(calculateTotalSolved(mockMembers[4])).toBe(2507)
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
