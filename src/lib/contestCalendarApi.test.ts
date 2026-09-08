vi.mock('./supabase', () => ({ supabaseUrl: 'https://project.supabase.co' }))

import { fetchContestCalendar, parseContestCalendarResponse } from './contestCalendarApi'

const payload = {
  events: [
    {
      id: 'contest-1',
      name: 'AtCoder Beginner Contest 475',
      platform: 'atcoder.jp',
      url: 'https://atcoder.jp/contests/abc475',
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T14:00:00.000Z',
      introductory: true,
    },
    {
      id: 'bad-host',
      name: 'Not official',
      platform: 'atcoder.jp',
      url: 'https://example.com/contest',
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T14:00:00.000Z',
      introductory: false,
    },
  ],
  fetchedAt: '2026-09-07T04:00:00.000Z',
  windowStart: '2026-09-04T16:00:00.000Z',
  windowEnd: '2026-09-21T15:59:59.999Z',
}

describe('contest calendar API validation', () => {
  it('keeps only HTTPS links on the exact allowlisted platform', () => {
    expect(parseContestCalendarResponse(payload).events).toHaveLength(1)
    expect(parseContestCalendarResponse(payload).events[0].url).toBe(
      'https://atcoder.jp/contests/abc475',
    )
  })

  it('builds a bounded function request and validates the response', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('contest-calendar?start=')
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    const result = await fetchContestCalendar(
      {
        startAt: new Date('2026-09-04T16:00:00.000Z'),
        endAt: new Date('2026-09-21T15:59:59.999Z'),
      },
      fetcher,
    )
    expect(result.events).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
