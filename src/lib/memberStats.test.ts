import { mapPublicStatStatus } from './memberStats'

describe('public statistic freshness', () => {
  const now = Date.parse('2026-07-13T12:00:00Z')

  it('marks a fresh row stale after its deadline passes', () => {
    expect(mapPublicStatStatus('fresh', '2026-07-13T11:59:59Z', now)).toBe('stale')
  })

  it('keeps a fresh row fresh before its deadline', () => {
    expect(mapPublicStatStatus('fresh', '2026-07-13T12:00:01Z', now)).toBe('fresh')
  })

  it('maps unavailable rows to an error state', () => {
    expect(mapPublicStatStatus('unavailable', null, now)).toBe('error')
  })
})
