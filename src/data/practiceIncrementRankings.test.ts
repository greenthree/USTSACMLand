import { describe, expect, it, vi } from 'vitest'
import {
  loadPublicPracticeIncrementsFromClient,
  requirePublicPracticeIncrementRows,
} from './practiceIncrementRankings'

const validRow = {
  profile_id: '00000000-0000-0000-0000-000000000001',
  platform: 'codeforces' as const,
  solved_delta: 12,
  baseline_solved_count: 100,
  end_solved_count: 112,
  baseline_recorded_at: '2026-07-12T19:00:00+08:00',
  end_recorded_at: '2026-07-18T07:00:00+08:00',
  coverage_status: 'complete',
}

describe('public practice increment data', () => {
  it('loads a bounded RPC range and maps sanitized rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [validRow], error: null })
    const rows = await loadPublicPracticeIncrementsFromClient({ rpc } as never, {
      startDate: '2026-07-13',
      endDate: '2026-07-18',
    })

    expect(rpc).toHaveBeenCalledWith('get_public_practice_increments', {
      range_start_date: '2026-07-13',
      range_end_date: '2026-07-18',
    })
    expect(rows).toEqual([
      {
        memberId: validRow.profile_id,
        platform: 'codeforces',
        delta: 12,
        baselineCount: 100,
        endCount: 112,
        baselineAt: validRow.baseline_recorded_at,
        endAt: validRow.end_recorded_at,
        coverageStatus: 'complete',
      },
    ])
  })

  it('rejects duplicated member-platform rows', () => {
    expect(() => requirePublicPracticeIncrementRows([validRow, validRow])).toThrow(
      '公开刷题增量返回了重复记录',
    )
  })

  it('rejects inconsistent coverage payloads', () => {
    expect(() =>
      requirePublicPracticeIncrementRows([
        {
          ...validRow,
          solved_delta: 3,
          baseline_solved_count: null,
          coverage_status: 'missing_baseline',
        },
      ]),
    ).toThrow('公开刷题增量为未覆盖记录返回了新增题数')
    expect(() =>
      requirePublicPracticeIncrementRows([
        { ...validRow, solved_delta: 2, coverage_status: 'count_decreased' },
      ]),
    ).toThrow('公开刷题增量的题数回退记录必须按 0 计')
  })

  it('surfaces RPC failures without returning partial rows', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'network unavailable' },
    })
    await expect(
      loadPublicPracticeIncrementsFromClient({ rpc } as never, {
        startDate: '2026-07-13',
        endDate: '2026-07-18',
      }),
    ).rejects.toThrow('刷题增量读取失败：network unavailable')
  })
})
