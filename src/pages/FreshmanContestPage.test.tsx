import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FreshmanContestPage } from './FreshmanContestPage'

describe('FreshmanContestPage', () => {
  it('introduces the event format, timeline and participation requirements', () => {
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '新生赛', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('新生赛赛制概览')).toHaveTextContent('02:00:00')
    expect(screen.getByLabelText('十道题难度分布')).toHaveTextContent('L1')
    expect(screen.getByLabelText('十道题难度分布')).toHaveTextContent('L2')
    expect(screen.getByLabelText('十道题难度分布')).toHaveTextContent('L3')
    expect(screen.getByRole('heading', { name: '从开场到最终榜' })).toBeInTheDocument()
    expect(screen.getByText('最后一小时封榜')).toBeInTheDocument()
    expect(screen.getByText('连接比赛指定局域网，禁止连接手机热点。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '从第一题开始准备' })).toHaveAttribute(
      'href',
      '/learning',
    )
  })

  it('switches to the L3 answer-sheet scoring explanation', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('tab', { name: 'L1语法题03 题' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByLabelText('L3 答题卡计分公式')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'L3思维题05 题' }))

    expect(screen.getByRole('tab', { name: 'L3思维题05 题' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText(/可在纸质答题卡写下结论与推导过程/)).toBeInTheDocument()
    expect(screen.getByLabelText('L3 答题卡计分公式')).toHaveTextContent(
      '题目满分 × 结论百分比 × 过程百分比',
    )
  })

  it('switches the cover and rules to the traditional ACM school contest', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    const schoolContestTab = screen.getByRole('tab', { name: /校赛/ })
    await user.click(schoolContestTab)

    expect(schoolContestTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '校赛', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('校赛赛制概览')).toHaveTextContent('05:00:00')
    expect(
      screen.getByRole('heading', { name: '把三个人的判断，压缩进一台电脑' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('传统 ACM 罚时公式')).toHaveTextContent('错误提交数 × 20 分钟')
  })

  it('supports horizontal swipe between the two contest covers', () => {
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    const contestHero = screen.getByRole('region', { name: '校内赛事' })
    fireEvent.pointerDown(contestHero, { clientX: 80, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 180, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /校赛/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '校赛', level: 1 })).toBeInTheDocument()
  })
})
