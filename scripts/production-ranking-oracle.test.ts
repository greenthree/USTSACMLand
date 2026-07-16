import {
  buildMembers,
  calculateBenchmarks,
  calculateOverallRating,
  calculateTotalSolved,
  expectedRows,
  formatDecimal,
  formatInteger,
  type PublicMemberRow,
  type PublicStatRow,
} from './production-ranking-oracle'

const memberRows: PublicMemberRow[] = Array.from({ length: 6 }, (_, index) => ({
  id: `member-${index + 1}`,
  full_name: `成员${index + 1}`,
  major: '计算机科学与技术',
  grade: '24级',
}))

const statRows: PublicStatRow[] = memberRows.flatMap((member, index) => [
  {
    profile_id: member.id,
    platform: 'codeforces',
    current_rating: 2000 - index * 100,
    max_rating: 2100 - index * 100,
    solved_count: 100 + index,
  },
  {
    profile_id: member.id,
    platform: 'nowcoder',
    current_rating: index === 5 ? 2500 : 1600 - index * 50,
    max_rating: index === 5 ? 2600 : 1700 - index * 50,
    solved_count: 200 + index,
  },
  {
    profile_id: member.id,
    platform: 'atcoder',
    current_rating: 1500 - index * 50,
    max_rating: 1550 - index * 50,
    solved_count: 300 + index,
  },
  {
    profile_id: member.id,
    platform: 'xcpc_elo',
    current_rating: 1700 - index * 25,
    max_rating: index === 5 ? null : 1800 - index * 25,
    solved_count: null,
  },
  {
    profile_id: member.id,
    platform: 'luogu',
    current_rating: null,
    max_rating: null,
    solved_count: 400 + index,
  },
  {
    profile_id: member.id,
    platform: 'qoj',
    current_rating: null,
    max_rating: null,
    solved_count: index === 5 ? null : 500 + index,
  },
])

describe('production ranking oracle', () => {
  it('uses an independent top five for every current and peak Rating platform', () => {
    const members = buildMembers(memberRows, statRows)

    expect(calculateBenchmarks(members, 'currentRating')).toEqual({
      codeforces: 1800,
      nowcoder: 1720,
      atcoder: 1400,
      xcpc_elo: 1650,
    })
    expect(calculateBenchmarks(members, 'maxRating')).toEqual({
      codeforces: 1900,
      nowcoder: 1820,
      atcoder: 1450,
      xcpc_elo: 1750,
    })
  })

  it('calculates, formats and sorts every aggregate without treating missing values as leaders', () => {
    const members = buildMembers(memberRows, statRows)
    const benchmarks = calculateBenchmarks(members, 'currentRating')
    const ratingRows = expectedRows(
      members,
      (member) => calculateOverallRating(member, benchmarks, 'currentRating'),
      formatDecimal,
    )
    const solvedRows = expectedRows(members, calculateTotalSolved, formatInteger)

    expect(ratingRows.map((row) => row.id)).toEqual([
      'member-1',
      'member-6',
      'member-2',
      'member-3',
      'member-4',
      'member-5',
    ])
    expect(ratingRows[0].primaryValue).toBe('1,657.23')
    expect(solvedRows[0]).toMatchObject({ id: 'member-5', primaryValue: '1,520' })
    expect(solvedRows.at(-1)).toMatchObject({ id: 'member-6', primaryValue: '1,020' })
  })

  it('returns no aggregate when every applicable value is missing', () => {
    const members = buildMembers(memberRows.slice(0, 1), [])
    const emptyBenchmarks = calculateBenchmarks(members, 'currentRating')

    expect(calculateOverallRating(members[0], emptyBenchmarks, 'currentRating')).toBeNull()
    expect(calculateTotalSolved(members[0])).toBeNull()
    expect(formatDecimal(null)).toBe('--')
    expect(formatInteger(null)).toBe('--')
  })
})
