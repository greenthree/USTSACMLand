import { mapPublicStatStatus } from './memberStats'

describe('public statistic freshness', () => {
  const lastSuccessAt = '2026-07-13T05:56:31Z'

  it('keeps daily data fresh through the latest scheduled update grace period', () => {
    expect(
      mapPublicStatStatus('fresh', 'codeforces', lastSuccessAt, Date.parse('2026-07-13T12:59:59Z')),
    ).toBe('fresh')
  })

  it('marks data stale only after it misses the latest scheduled window', () => {
    expect(
      mapPublicStatStatus('fresh', 'codeforces', lastSuccessAt, Date.parse('2026-07-13T13:00:00Z')),
    ).toBe('stale')
  })

  it('does not expose a premature database stale flag before the scheduled deadline', () => {
    expect(
      mapPublicStatStatus('stale', 'codeforces', lastSuccessAt, Date.parse('2026-07-13T12:00:00Z')),
    ).toBe('fresh')
  })

  it('uses the Tuesday update window and one-day grace for weekly platforms', () => {
    const weeklySuccess = '2026-07-13T12:38:36Z'
    expect(
      mapPublicStatStatus('fresh', 'qoj', weeklySuccess, Date.parse('2026-07-14T23:59:59Z')),
    ).toBe('fresh')
    expect(
      mapPublicStatStatus('fresh', 'qoj', weeklySuccess, Date.parse('2026-07-15T00:00:00Z')),
    ).toBe('stale')
  })

  it('maps unavailable rows to an error state', () => {
    expect(
      mapPublicStatStatus('unavailable', 'codeforces', null, Date.parse('2026-07-13T12:00:00Z')),
    ).toBe('error')
  })
})
