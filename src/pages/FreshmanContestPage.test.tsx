import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FreshmanContestPage } from './FreshmanContestPage'

describe('FreshmanContestPage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('reveals the lowest pending team from left to right and reranks it after an AC', () => {
    vi.useFakeTimers()
    const { container } = render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('tab', { name: /校赛/ }))

    const boundaryRow = container.querySelector<HTMLElement>('[data-rollboard-team="boundary"]')
    const boundaryProblemG = boundaryRow?.querySelector<HTMLElement>('[data-rollboard-problem="G"]')
    const boundaryProblemK = boundaryRow?.querySelector<HTMLElement>('[data-rollboard-problem="K"]')
    const boundaryRank = boundaryRow?.querySelector<HTMLElement>('.school-rollboard-rank')
    const boundarySolved = boundaryRow?.querySelector<HTMLElement>('.school-rollboard-solved')
    const oneShotRow = container.querySelector<HTMLElement>('[data-rollboard-team="one-shot"]')
    const oneShotProblemG = oneShotRow?.querySelector<HTMLElement>('[data-rollboard-problem="G"]')
    const rollboardRows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-rollboard-team]'),
    )
    const pendingProblems = Array.from(
      container.querySelectorAll<HTMLElement>('.school-rollboard-problem.is-pending'),
    )

    expect(
      pendingProblems.every((problem) => /^[1-9]\d*\/\d+$/.test(problem.textContent ?? '')),
    ).toBe(true)

    for (const problemLabel of ['B', 'D', 'F', 'H', 'I', 'L']) {
      expect(
        rollboardRows.every((row) =>
          row
            .querySelector(`[data-rollboard-problem="${problemLabel}"]`)
            ?.classList.contains('is-ac'),
        ),
      ).toBe(true)
    }

    for (const problemLabel of ['E', 'J']) {
      expect(
        rollboardRows.every((row) =>
          row
            .querySelector(`[data-rollboard-problem="${problemLabel}"]`)
            ?.classList.contains('is-empty'),
        ),
      ).toBe(true)
    }

    expect(boundaryRow).toHaveClass('is-current')
    expect(boundaryRank).toHaveTextContent('05')
    expect(boundarySolved).toHaveTextContent('08')
    expect(boundaryProblemG).toHaveTextContent('2/244')
    expect(boundaryProblemG).toHaveClass('is-active')

    act(() => {
      vi.advanceTimersByTime(1350)
    })

    expect(boundaryProblemG).toHaveTextContent('2/244')
    expect(boundaryProblemG).toHaveClass('is-wa')
    expect(boundaryProblemG).toHaveAttribute('title', expect.stringContaining('最后一次提交'))
    expect(boundaryRow).toHaveClass('is-current')
    expect(boundaryRank).toHaveTextContent('05')
    expect(boundarySolved).toHaveTextContent('08')
    expect(screen.getByRole('region', { name: '滚榜动画演示' })).toHaveTextContent(
      'CURRENT / 航电一队 / K',
    )

    act(() => {
      vi.advanceTimersByTime(1350)
    })

    expect(boundaryProblemK).toHaveTextContent('3/130')
    expect(boundaryProblemK).toHaveClass('is-ac')
    expect(boundaryProblemK).toHaveAttribute('title', expect.stringContaining('首次 AC'))
    expect(boundaryRow).toHaveClass('is-current')
    expect(boundaryRow).toHaveClass('is-rising')
    expect(oneShotRow).not.toHaveClass('is-current')
    expect(oneShotProblemG).not.toHaveClass('is-active')
    expect(boundaryRank).toHaveTextContent('04')
    expect(boundarySolved).toHaveTextContent('09')
    expect(screen.getByRole('region', { name: '滚榜动画演示' })).toHaveTextContent(
      'RISING / 航电一队 / K',
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(boundaryRow).toHaveClass('is-current')
    expect(boundaryRow).toHaveClass('is-rising')
    expect(oneShotRow).not.toHaveClass('is-current')

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(boundaryRow).not.toHaveClass('is-current')
    expect(boundaryRow).not.toHaveClass('is-rising')
    expect(oneShotRow).toHaveClass('is-current')
    expect(oneShotProblemG).toHaveClass('is-active')
    expect(screen.getByRole('region', { name: '滚榜动画演示' })).toHaveTextContent(
      'CURRENT / 一路向南 / G',
    )

    for (let timerIndex = 0; timerIndex < 7; timerIndex += 1) {
      act(() => {
        vi.advanceTimersToNextTimer()
      })
    }

    const finalRanking = rollboardRows
      .map((row) => ({
        rank: Number(row.querySelector('.school-rollboard-rank')?.textContent),
        team: row.querySelector('strong')?.textContent,
      }))
      .sort((left, right) => left.rank - right.rank)
      .map((entry) => entry.team)

    expect(finalRanking).toEqual(['CF皇帝', '零基础新生0队', '春日影', '一路向南', '航电一队'])
    expect(screen.getByRole('region', { name: '滚榜动画演示' })).toHaveTextContent(
      'FINAL / COMPLETE',
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

    const rollboard = screen.getByRole('region', { name: '滚榜动画演示' })
    expect(rollboard).toHaveTextContent('从最后一支待揭晓队伍开始')
    expect(rollboard).toHaveTextContent('名次队伍ABCDEFGHIJKLAC罚时')
    expect(rollboard).toHaveTextContent('CURRENT / 航电一队 / G')
    expect(screen.getByRole('img', { name: /从最低名次的待揭晓队伍开始/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '暂停滚榜动画' }))
    expect(rollboard).toHaveClass('is-paused')
    expect(screen.getByRole('button', { name: '继续滚榜动画' })).toBeInTheDocument()
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
