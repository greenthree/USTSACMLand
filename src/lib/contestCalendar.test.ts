import {
  formatBeijingDateTime,
  formatCountdown,
  getContestStatus,
  getContestWindow,
  isIntroductoryContest,
} from './contestCalendar'

describe('contest calendar helpers', () => {
  it('computes the Beijing two-day-back to fourteen-day-forward window', () => {
    const window = getContestWindow(new Date('2026-09-07T04:00:00.000Z'))
    expect(window.startAt.toISOString()).toBe('2026-09-04T16:00:00.000Z')
    expect(window.endAt.toISOString()).toBe('2026-09-21T15:59:59.999Z')
  })

  it('classifies contest status and formats countdowns', () => {
    const event = { startAt: '2026-09-07T05:00:00.000Z', endAt: '2026-09-07T07:00:00.000Z' }
    expect(getContestStatus(event, new Date('2026-09-07T04:59:59.000Z'))).toBe('upcoming')
    expect(getContestStatus(event, new Date('2026-09-07T06:00:00.000Z'))).toBe('live')
    expect(getContestStatus(event, new Date('2026-09-07T07:00:00.000Z'))).toBe('ended')
    expect(formatCountdown(90_061_000)).toBe('1天 01:01:01')
    expect(formatCountdown(3_661_000)).toBe('01:01:01')
  })

  it('formats Beijing time and introductory contest labels', () => {
    expect(formatBeijingDateTime('2026-09-07T04:00:00.000Z')).toBe('2026-09-07 12:00')
    expect(isIntroductoryContest('Codeforces Round (Div. 4)')).toBe(true)
    expect(isIntroductoryContest('牛客周赛 Round 161')).toBe(true)
    expect(isIntroductoryContest('AtCoder Beginner Contest 475')).toBe(true)
    expect(isIntroductoryContest('Codeforces Round (Div. 2)')).toBe(false)
  })
})
