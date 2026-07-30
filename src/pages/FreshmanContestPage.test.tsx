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

  it('uses the ladder-style practice contest as an individual qualifier', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    const practiceContestTab = screen.getByRole('tab', { name: /练习赛/ })
    await user.click(practiceContestTab)

    expect(practiceContestTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '练习赛', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('练习赛赛制概览')).toHaveTextContent('03:00:00')
    expect(screen.getByLabelText('练习赛赛制概览')).toHaveTextContent('个人选拔赛')
    expect(screen.getByLabelText('练习赛赛制概览')).toHaveTextContent('赛后队伍编排')
    expect(screen.getByLabelText('天梯赛三级赛题结构')).toHaveTextContent('8 题 / 100 分')
    expect(screen.getByLabelText('天梯赛三级赛题结构')).toHaveTextContent('4 题 / 100 分')
    expect(screen.getByLabelText('天梯赛三级赛题结构')).toHaveTextContent('3 题 / 90 分')
    expect(
      screen.getByRole('heading', { name: '每个测试点，都能留下有效得分' }),
    ).toBeInTheDocument()
    expect(screen.getByText('30–60 分钟')).toBeInTheDocument()
    expect(screen.getByText('第 2 小时')).toBeInTheDocument()
    expect(screen.getByText('剩余时间')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '不与一次错误提交较劲，让总分持续向上。' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/阶段目标不是硬性截止/)).toHaveTextContent(
      '前 30–60 分钟完成会写的 L1，第 2 小时解决会写的 L2',
    )
    expect(
      screen.getByText(/选拔参加“中国高校计算机大赛——团体程序设计天梯赛”的选手/),
    ).toBeInTheDocument()
    expect(screen.getByText('依据成绩编排天梯赛队伍')).toBeInTheDocument()
    expect(screen.queryByText('团队累计成绩')).not.toBeInTheDocument()
  })

  it('supports horizontal swipe across all three contest covers', () => {
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    const contestHero = screen.getByRole('region', { name: '校内赛事' })
    fireEvent.pointerDown(contestHero, { clientX: 80, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 180, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /练习赛/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '练习赛', level: 1 })).toBeInTheDocument()

    fireEvent.pointerDown(contestHero, { clientX: 80, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 180, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /校赛/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '校赛', level: 1 })).toBeInTheDocument()

    fireEvent.pointerDown(contestHero, { clientX: 180, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 80, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /练习赛/ })).toHaveAttribute('aria-selected', 'true')
  })
})
