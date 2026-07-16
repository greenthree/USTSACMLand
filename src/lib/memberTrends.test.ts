import type { Member, RatingSnapshot } from '../types/domain'

const trendMocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  not: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { from: trendMocks.from },
}))

import {
  buildDemoRatingSnapshots,
  buildRatingTrendChartData,
  fetchPublicRatingSnapshots,
  mapPublicRatingSnapshots,
} from './memberTrends'

function snapshot(overrides: Partial<RatingSnapshot> = {}): RatingSnapshot {
  return {
    id: 1,
    platform: 'codeforces',
    rating: 1500,
    peakRating: 1600,
    recordedAt: '2026-07-01T00:00:00Z',
    sourceObservedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

describe('member Rating history', () => {
  beforeEach(() => {
    for (const mock of Object.values(trendMocks)) mock.mockReset()
    const query = {
      select: trendMocks.select,
      eq: trendMocks.eq,
      not: trendMocks.not,
      order: trendMocks.order,
      limit: trendMocks.limit,
    }
    trendMocks.from.mockReturnValue(query)
    trendMocks.select.mockReturnValue(query)
    trendMocks.eq.mockReturnValue(query)
    trendMocks.not.mockReturnValue(query)
    trendMocks.order.mockReturnValue(query)
  })

  it('maps valid public rows, orders them chronologically, and rejects malformed values', () => {
    expect(
      mapPublicRatingSnapshots([
        {
          id: 2,
          platform: 'codeforces',
          current_rating: 1600,
          max_rating: 1650,
          recorded_at: '2026-07-02T00:00:00Z',
          source_observed_at: '2026-07-02T00:00:00Z',
          status: 'fresh',
        },
        {
          id: 1,
          platform: 'codeforces',
          current_rating: 1500,
          max_rating: 1500,
          recorded_at: '2026-07-01T00:00:00Z',
          source_observed_at: '2026-07-01T00:00:00Z',
          status: 'fresh',
        },
        {
          id: 3,
          platform: 'luogu',
          current_rating: 1800,
          max_rating: 1800,
          recorded_at: '2026-07-03T00:00:00Z',
          source_observed_at: null,
          status: 'fresh',
        },
        {
          id: 4,
          platform: 'atcoder',
          current_rating: null,
          max_rating: null,
          recorded_at: 'invalid',
          source_observed_at: null,
          status: 'fresh',
        },
        {
          id: 5,
          platform: 'atcoder',
          current_rating: 1300,
          max_rating: 1300,
          recorded_at: '2026-07-03T00:00:00Z',
          source_observed_at: null,
          status: 'stale',
        },
      ]),
    ).toEqual([
      snapshot({ id: 1, rating: 1500, peakRating: 1500 }),
      snapshot({
        id: 2,
        rating: 1600,
        peakRating: 1650,
        recordedAt: '2026-07-02T00:00:00Z',
        sourceObservedAt: '2026-07-02T00:00:00Z',
      }),
    ])
  })

  it('retains at most the latest one hundred points per platform', () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
      id: index + 1,
      platform: 'codeforces' as const,
      current_rating: 1000 + index,
      max_rating: 1000 + index,
      recorded_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      source_observed_at: null,
      status: 'fresh',
    }))

    const result = mapPublicRatingSnapshots(rows)
    expect(result).toHaveLength(100)
    expect(result[0].rating).toBe(1005)
    expect(result.at(-1)?.rating).toBe(1104)
  })

  it('queries the sanitized public snapshot view with a bounded result set', async () => {
    trendMocks.limit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            platform: 'atcoder',
            current_rating: 1300,
            max_rating: 1400,
            recorded_at: '2026-07-01T00:00:00Z',
            source_observed_at: null,
            status: 'fresh',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(fetchPublicRatingSnapshots('member-1')).resolves.toEqual([
      snapshot({
        platform: 'atcoder',
        rating: 1300,
        peakRating: 1400,
        sourceObservedAt: null,
      }),
    ])
    expect(trendMocks.from).toHaveBeenCalledTimes(4)
    expect(trendMocks.from).toHaveBeenCalledWith('public_stat_snapshots')
    expect(trendMocks.eq).toHaveBeenCalledTimes(12)
    expect(trendMocks.eq).toHaveBeenCalledWith('profile_id', 'member-1')
    expect(trendMocks.eq).toHaveBeenCalledWith('platform', 'codeforces')
    expect(trendMocks.eq).toHaveBeenCalledWith('platform', 'nowcoder')
    expect(trendMocks.eq).toHaveBeenCalledWith('platform', 'atcoder')
    expect(trendMocks.eq).toHaveBeenCalledWith('platform', 'xcpc_elo')
    expect(trendMocks.eq).toHaveBeenCalledWith('status', 'fresh')
    expect(trendMocks.order).toHaveBeenCalledWith('recorded_at', { ascending: false })
    expect(trendMocks.limit).toHaveBeenCalledTimes(4)
    expect(trendMocks.limit).toHaveBeenCalledWith(200)
  })

  it('deduplicates authoritative source times and keeps the latest stored version', () => {
    const result = mapPublicRatingSnapshots([
      {
        id: 1,
        platform: 'codeforces',
        current_rating: 1400,
        max_rating: 1400,
        recorded_at: '2026-07-01T08:00:00Z',
        source_observed_at: '2026-07-01T07:00:00Z',
        status: 'fresh',
      },
      {
        id: 2,
        platform: 'codeforces',
        current_rating: 1450,
        max_rating: 1450,
        recorded_at: '2026-07-01T09:00:00Z',
        source_observed_at: '2026-07-01T07:00:00Z',
        status: 'fresh',
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 2, rating: 1450 })
  })

  it('builds deterministic demonstration histories from current and peak ratings', () => {
    const member = {
      id: 'member-1',
      name: '测试成员',
      major: '计算机科学与技术',
      grade: '24级',
      bio: '',
      reviewStatus: 'approved',
      joinedAt: '2024-09-01',
      stats: {
        codeforces: {
          platform: 'codeforces',
          externalId: 'tester',
          rating: 1600,
          peakRating: 1700,
          solved: 100,
          status: 'fresh',
          updatedAt: null,
        },
        nowcoder: {
          platform: 'nowcoder',
          externalId: '',
          rating: null,
          peakRating: null,
          solved: null,
          status: 'missing',
          updatedAt: null,
        },
        atcoder: {
          platform: 'atcoder',
          externalId: '',
          rating: null,
          peakRating: null,
          solved: null,
          status: 'missing',
          updatedAt: null,
        },
        xcpc_elo: {
          platform: 'xcpc_elo',
          externalId: '',
          rating: null,
          peakRating: null,
          solved: null,
          status: 'missing',
          updatedAt: null,
        },
        luogu: {
          platform: 'luogu',
          externalId: '',
          rating: null,
          peakRating: null,
          solved: null,
          status: 'missing',
          updatedAt: null,
        },
        qoj: {
          platform: 'qoj',
          externalId: '',
          rating: null,
          peakRating: null,
          solved: null,
          status: 'missing',
          updatedAt: null,
        },
      },
    } satisfies Member

    const result = buildDemoRatingSnapshots(member)
    expect(result).toHaveLength(6)
    expect(result.at(-1)).toMatchObject({ platform: 'codeforces', rating: 1600 })
    expect(Math.max(...result.map((item) => item.rating))).toBe(1700)
  })

  it('lays out unsorted and flat histories without invalid coordinates', () => {
    const result = buildRatingTrendChartData([
      snapshot({
        id: 2,
        recordedAt: '2026-07-02T00:00:00Z',
        sourceObservedAt: '2026-07-02T00:00:00Z',
      }),
      snapshot({ id: 1, recordedAt: '2026-07-01T00:00:00Z' }),
    ])

    expect(result.points.map((point) => point.id)).toEqual([1, 2])
    expect(
      result.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    ).toBe(true)
    expect(result.yTicks).toHaveLength(5)
    expect(buildRatingTrendChartData([snapshot()]).points[0].x).toBe(425)
    expect(() => buildRatingTrendChartData([])).toThrow('at least one snapshot')
  })

  it('spaces points according to their real observation times', () => {
    const result = buildRatingTrendChartData([
      snapshot({ id: 1, sourceObservedAt: '2026-07-01T00:00:00Z' }),
      snapshot({ id: 2, sourceObservedAt: '2026-07-02T00:00:00Z' }),
      snapshot({ id: 3, sourceObservedAt: '2026-07-11T00:00:00Z' }),
    ])

    const firstGap = result.points[1].x - result.points[0].x
    const secondGap = result.points[2].x - result.points[1].x
    expect(secondGap).toBeGreaterThan(firstGap * 5)
  })
})
