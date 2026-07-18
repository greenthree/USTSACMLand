import { describe, expect, it } from 'vitest'
import { mockMembers } from '../data/mock'
import type { Member } from '../types/domain'
import {
  buildPracticeIncrementMembers,
  currentBeijingDate,
  formatPracticeDateRange,
  practicePresetRange,
  validatePracticeDateRange,
  type PracticeIncrementRecord,
} from './practiceIncrements'

describe('practice increment calendar helpers', () => {
  it('uses the Beijing calendar across the UTC day boundary', () => {
    expect(currentBeijingDate(new Date('2026-07-18T15:59:59.000Z'))).toBe('2026-07-18')
    expect(currentBeijingDate(new Date('2026-07-18T16:00:00.000Z'))).toBe('2026-07-19')
  })

  it('builds Monday-based week and calendar-month presets', () => {
    expect(practicePresetRange('week', '2026-07-18')).toEqual({
      startDate: '2026-07-13',
      endDate: '2026-07-18',
    })
    expect(practicePresetRange('month', '2026-07-18')).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-18',
    })
  })

  it('validates order, future dates and the 366-day maximum', () => {
    expect(
      validatePracticeDateRange({ startDate: '2025-07-19', endDate: '2026-07-18' }, '2026-07-18'),
    ).toBeNull()
    expect(
      validatePracticeDateRange({ startDate: '2025-07-17', endDate: '2026-07-18' }, '2026-07-18'),
    ).toBe('单次最多统计 366 天。')
    expect(
      validatePracticeDateRange({ startDate: '2026-07-19', endDate: '2026-07-18' }, '2026-07-18'),
    ).toBe('开始日期不能晚于结束日期。')
    expect(
      validatePracticeDateRange({ startDate: '2026-07-18', endDate: '2026-07-19' }, '2026-07-18'),
    ).toBe('结束日期不能晚于北京时间今天。')
  })

  it('formats a compact human-readable range', () => {
    expect(formatPracticeDateRange({ startDate: '2026-07-13', endDate: '2026-07-18' })).toBe(
      '2026年7月13日—7月18日',
    )
  })
})

describe('buildPracticeIncrementMembers', () => {
  it('aggregates known deltas while preserving incomplete and adjusted coverage', () => {
    const member = structuredClone(mockMembers[0]) as Member
    const records: PracticeIncrementRecord[] = [
      {
        memberId: member.id,
        platform: 'codeforces',
        delta: 12,
        baselineCount: 100,
        endCount: 112,
        baselineAt: '2026-07-12T19:00:00+08:00',
        endAt: '2026-07-18T07:00:00+08:00',
        coverageStatus: 'complete',
      },
      {
        memberId: member.id,
        platform: 'nowcoder',
        delta: 0,
        baselineCount: 50,
        endCount: 45,
        baselineAt: '2026-07-12T19:00:00+08:00',
        endAt: '2026-07-18T07:00:00+08:00',
        coverageStatus: 'count_decreased',
      },
      {
        memberId: member.id,
        platform: 'atcoder',
        delta: null,
        baselineCount: null,
        endCount: 10,
        baselineAt: null,
        endAt: '2026-07-18T07:00:00+08:00',
        coverageStatus: 'missing_baseline',
      },
      {
        memberId: member.id,
        platform: 'luogu',
        delta: null,
        baselineCount: 20,
        endCount: null,
        baselineAt: '2026-07-12T19:00:00+08:00',
        endAt: null,
        coverageStatus: 'missing_end',
      },
      {
        memberId: member.id,
        platform: 'qoj',
        delta: null,
        baselineCount: null,
        endCount: null,
        baselineAt: null,
        endAt: null,
        coverageStatus: 'unbound',
      },
    ]

    const [result] = buildPracticeIncrementMembers([member], records)
    expect(result.totalDelta).toBe(12)
    expect(result.boundPlatformCount).toBe(4)
    expect(result.measuredPlatformCount).toBe(2)
    expect(result.adjustedPlatformCount).toBe(1)
    expect(result.stats.atcoder.coverageStatus).toBe('missing_baseline')
  })

  it('marks missing RPC rows unavailable instead of silently treating them as unbound', () => {
    const member = structuredClone(mockMembers[0]) as Member
    const [result] = buildPracticeIncrementMembers([member], [])
    expect(result.totalDelta).toBeNull()
    expect(result.boundPlatformCount).toBe(5)
    expect(result.measuredPlatformCount).toBe(0)
    expect(result.stats.codeforces.coverageStatus).toBe('unavailable')
  })
})
