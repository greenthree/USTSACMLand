import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RatingSnapshot } from '../types/domain'
import { RatingTrendSection } from './RatingTrendSection'

const snapshots: RatingSnapshot[] = [
  {
    id: 1,
    platform: 'codeforces',
    rating: 1400,
    peakRating: 1400,
    recordedAt: '2026-06-01T00:00:00Z',
    sourceObservedAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 2,
    platform: 'codeforces',
    rating: 1550,
    peakRating: 1550,
    recordedAt: '2026-07-01T00:00:00Z',
    sourceObservedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 3,
    platform: 'atcoder',
    rating: 1200,
    peakRating: 1200,
    recordedAt: '2026-07-01T00:00:00Z',
    sourceObservedAt: null,
  },
]

describe('RatingTrendSection', () => {
  it('renders real snapshot values and switches platforms', async () => {
    const user = userEvent.setup()
    render(
      <RatingTrendSection
        memberName="测试成员"
        snapshots={snapshots}
        loading={false}
        error={null}
        demo={false}
      />,
    )

    expect(
      screen.getByRole('img', { name: /测试成员的Codeforces Rating 趋势/ }),
    ).toBeInTheDocument()
    const summary = screen.getByLabelText('Codeforces Rating 历史摘要')
    expect(within(summary).getAllByText('1,550')).toHaveLength(2)
    expect(
      screen.getByRole('table', { name: '测试成员的Codeforces Rating 历史明细' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Codeforces，2 个历史点' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'AtCoder，1 个历史点' }))
    expect(screen.getByRole('img', { name: /测试成员的AtCoder Rating 趋势/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AtCoder，1 个历史点' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByText('目前只有 1 个历史点；至少积累 2 个点后才能观察 Rating 变化。'),
    ).toBeInTheDocument()
  })

  it('shows an empty state for a selected platform without history', async () => {
    const user = userEvent.setup()
    render(
      <RatingTrendSection
        memberName="测试成员"
        snapshots={snapshots}
        loading={false}
        error={null}
        demo={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'XCPC ELO，0 个历史点' }))
    expect(screen.getByText('暂无 XCPC ELO Rating 历史')).toBeInTheDocument()
  })

  it('distinguishes loading and failed history states', () => {
    const { rerender } = render(
      <RatingTrendSection memberName="测试成员" snapshots={[]} loading error={null} demo={false} />,
    )
    expect(screen.getByText('正在读取 Rating 历史')).toBeInTheDocument()

    rerender(
      <RatingTrendSection
        memberName="测试成员"
        snapshots={[]}
        loading={false}
        error="Rating 历史读取失败：无权限"
        demo={false}
      />,
    )
    const message = screen.getByRole('alert')
    expect(within(message).getByText('Rating 历史暂不可用')).toBeInTheDocument()
    expect(message).toHaveTextContent('无权限')
  })
})
