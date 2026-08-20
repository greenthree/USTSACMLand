import { describe, expect, it } from 'vitest'
import {
  formatBeijingDate,
  formatDailyArticleDate,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatInteger,
  formatShortDate,
} from './format'

describe('format utilities', () => {
  it('formats date time with fallback and enforces Asia/Shanghai timezone', () => {
    expect(formatDateTime(null)).toBe('尚未同步')
    // UTC 00:30 on 2026-08-20 is 08:30 Beijing time
    expect(formatDateTime('2026-08-20T00:30:00Z')).toBe('08/20 08:30')
    // UTC 23:45 on 2026-08-19 crosses midnight into 07:45 on 2026-08-20 Beijing time
    expect(formatDateTime('2026-08-19T23:45:00Z')).toBe('08/20 07:45')
  })

  it('formats short date with fallback and enforces Asia/Shanghai timezone', () => {
    expect(formatShortDate(null)).toBe('--')
    expect(formatShortDate('2026-08-20')).toBe('08/20')
    // UTC 18:00 on 2026-08-19 is 02:00 on 2026-08-20 in Beijing time
    expect(formatShortDate('2026-08-19T18:00:00Z')).toBe('08/20')
  })

  it('formats daily article date with weekday and month', () => {
    expect(formatDailyArticleDate(null)).toBe('--')
    expect(formatDailyArticleDate('2026-08-20')).toContain('8月20日')
    // UTC 18:00 on 2026-08-19 is 2026-08-20 in Beijing time
    expect(formatDailyArticleDate('2026-08-19T18:00:00Z')).toContain('8月20日')
  })

  it('formats Beijing date with offset', () => {
    const today = formatBeijingDate(0)
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const future = formatBeijingDate(10)
    expect(future).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('formats integers, decimals, and durations', () => {
    expect(formatInteger(null)).toBe('--')
    expect(formatInteger(1234567)).toBe('1,234,567')

    expect(formatDecimal(null)).toBe('--')
    expect(formatDecimal(12.3456)).toBe('12.35')

    expect(formatDuration(null)).toBe('--')
    expect(formatDuration(500)).toBe('500 ms')
    expect(formatDuration(2500)).toBe('2.5 s')
  })
})
