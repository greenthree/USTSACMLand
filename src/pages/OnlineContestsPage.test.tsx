import { render, screen, within } from '@testing-library/react'

const contestMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('../lib/contestCalendarApi', () => ({
  fetchContestCalendar: contestMocks.fetch,
}))

import { OnlineContestsPage } from './OnlineContestsPage'

function createCalendar() {
  const now = Date.now()
  return {
    events: [
      {
        id: 'upcoming',
        name: 'AtCoder Beginner Contest 475',
        platform: 'atcoder.jp' as const,
        url: 'http/workspace/2fc770c62249',
        startAt: new Date(now + 86_400_000).toISOString(),
        endAt: new Date(now + 93_600_000).toISOString(),
        introductory: true,
      },
      {
        id: 'live',
        name: 'Codeforces Round 999',
        platform: 'codeforces.com' as const,
        url: 'http/workspace/21eb87f78e28',
        startAt: new Date(now - 3_600_000).toISOString(),
        endAt: new Date(now + 3_600_000).toISOString(),
        introductory: false,
      },
      {
        id: 'ended',
        name: '旧比赛',
        platform: 'codeforces.com' as const,
        url: 'http/workspace/bb0624dfe437',
        startAt: '2020-09-12T12:00:00.000Z',
        endAt: '2020-09-12T14:00:00.000Z',
        introductory: false,
      },
    ],
    fetchedAt: '2026-09-07T04:00:00.000Z',
    windowStart: '2026-09-04T16:00:00.000Z',
    windowEnd: '2026-09-21T15:59:59.999Z',
  }
}

describe('OnlineContestsPage', () => {
  beforeEach(() => {
    contestMocks.fetch.mockReset().mockResolvedValue(createCalendar())
  })

  it('renders one contest per table row with platform, duration, status, and official link', async () => {
    render(<OnlineContestsPage />)
    expect(await screen.findByRole('heading', { name: '线上比赛' })).toBeInTheDocument()

    const table = screen.getByRole('table', { name: '近期线上比赛' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    const introductoryLink = within(table).getByRole('link', {
      name: /AtCoder Beginner Contest 475/,
    })
    const introductoryRow = introductoryLink.closest('tr')
    expect(introductoryLink).toHaveAttribute('href', 'http/workspace/2fc770c62249')
    expect(introductoryRow).not.toBeNull()
    expect(within(introductoryRow as HTMLTableRowElement).getAllByRole('cell')).toHaveLength(6)
    expect(within(introductoryRow as HTMLTableRowElement).getByText('AtCoder')).toBeInTheDocument()
    expect(within(introductoryRow as HTMLTableRowElement).getByText('入门比赛')).toBeInTheDocument()
    expect(within(introductoryRow as HTMLTableRowElement).getByText('2小时')).toBeInTheDocument()
    expect(within(introductoryRow as HTMLTableRowElement).getByText(/距开始/)).toBeInTheDocument()
    expect(within(table).getByText(/距结束/)).toBeInTheDocument()
    expect(within(table).getByText('已结束')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument()
    expect(screen.getByText('后台每小时更新')).toBeInTheDocument()
  })

  it('shows a recoverable error without inventing events', async () => {
    contestMocks.fetch.mockRejectedValueOnce(new Error('network down'))
    render(<OnlineContestsPage />)
    expect(await screen.findByText('暂时无法获取线上比赛')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /前往 clist.by/ })).toHaveAttribute(
      'href',
      expect.stringContaining('clist.by'),
    )
    expect(screen.queryByRole('link', { name: /AtCoder/ })).not.toBeInTheDocument()
  })
})
