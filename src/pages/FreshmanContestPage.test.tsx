import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FreshmanContestPage } from './FreshmanContestPage'
import {
  completedSchoolRollboardTeams,
  schoolRollboardTeams,
} from './freshman-contest/freshmanContestData'

describe('FreshmanContestPage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps rolling scoreboard submissions and penalties consistent with a three-hour contest', () => {
    for (const entries of [schoolRollboardTeams, completedSchoolRollboardTeams()]) {
      for (const entry of entries) {
        const accepted = entry.problems.filter((problem) => problem.state === 'ac')
        expect(entry.solved).toBe(accepted.length)
        expect(entry.penalty).toBe(
          accepted.reduce(
            (sum, problem) => sum + problem.submissionTime! + (problem.attempts! - 1) * 20,
            0,
          ),
        )
        for (const problem of entry.problems) {
          if (problem.state === 'empty') continue
          expect(problem.submissionTime).toBeGreaterThanOrEqual(0)
          expect(problem.submissionTime).toBeLessThanOrEqual(180)
          if (problem.state === 'pending')
            expect(problem.submissionTime).toBeGreaterThanOrEqual(120)
        }
      }
    }
  })

  it('lists the November individual school contest before the March practice contest', () => {
    render(
      <MemoryRouter initialEntries={['/contests/campus']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )
    const tabs = within(screen.getByRole('tablist', { name: '选择校内赛事' })).getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('校赛')
    expect(tabs[0]).toHaveTextContent('11月 · 单人赛')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveTextContent('练习赛')
    expect(tabs[1]).toHaveTextContent('3月')
    expect(screen.getByRole('heading', { name: '校赛', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('校赛赛制概览')).toHaveTextContent('单人赛')
    expect(screen.getByRole('heading', { name: '做好个人准备，再进入赛场' })).toBeInTheDocument()
    expect(screen.getByText('个人报名')).toBeInTheDocument()
    expect(screen.getByText('独立设备')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('新生赛')
    expect(document.body).not.toHaveTextContent('三人一队')
    expect(document.body).not.toHaveTextContent('三人组队')
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
    expect(boundaryProblemG).toHaveTextContent('2/144')
    expect(boundaryProblemG).toHaveClass('is-active')

    act(() => {
      vi.advanceTimersByTime(1350)
    })

    expect(boundaryProblemG).toHaveTextContent('2/144')
    expect(boundaryProblemG).toHaveClass('is-wa')
    expect(boundaryProblemG).toHaveAttribute('title', expect.stringContaining('最后一次提交'))
    expect(boundaryRow).toHaveClass('is-current')
    expect(boundaryRank).toHaveTextContent('05')
    expect(boundarySolved).toHaveTextContent('08')
    expect(screen.getByRole('region', { name: '滚榜动画演示' })).toHaveTextContent(
      'CURRENT / 航电同学 / K',
    )

    act(() => {
      vi.advanceTimersByTime(1350)
    })

    expect(boundaryProblemK).toHaveTextContent('3/150')
    expect(boundaryProblemK).toHaveClass('is-ac')
    expect(boundaryProblemK).toHaveAttribute('title', expect.stringContaining('首次 AC'))
    expect(boundaryRow).toHaveClass('is-current')
    expect(boundaryRow).toHaveClass('is-rising')
    expect(oneShotRow).not.toHaveClass('is-current')
    expect(oneShotProblemG).not.toHaveClass('is-active')
    expect(boundaryRank).toHaveTextContent('04')
    expect(boundarySolved).toHaveTextContent('09')
    expect(screen.getByRole('region', { name: '滚榜动画演示' })).toHaveTextContent(
      'RISING / 航电同学 / K',
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

    expect(finalRanking).toEqual(['CF皇帝', '零基础选手', '春日影', '一路向南', '航电同学'])
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
    expect(screen.getByLabelText('校赛赛制概览')).toHaveTextContent('03:00:00')
    expect(screen.getByText('02:00')).toBeInTheDocument()
    expect(screen.getByText('03:00')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('五小时')
    expect(
      screen.getByRole('heading', { name: '一人一台电脑，独立完成每一次判断' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('传统 ACM 罚时公式')).toHaveTextContent('错误提交数 × 20 分钟')

    const rollboard = screen.getByRole('region', { name: '滚榜动画演示' })
    expect(rollboard).toHaveTextContent('从最后一位待揭晓选手开始')
    expect(rollboard).toHaveTextContent('名次选手ABCDEFGHIJKLAC罚时')
    expect(rollboard).toHaveTextContent('CURRENT / 航电同学 / G')
    expect(screen.getByRole('img', { name: /从最低名次的待揭晓选手开始/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '暂停滚榜动画' }))
    expect(rollboard).toHaveClass('is-paused')
    expect(screen.getByRole('button', { name: '继续滚榜动画' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '往届题目入口' })).toHaveAttribute(
      'href',
      'https://usts.fun/training/21',
    )
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
    expect(screen.getByRole('link', { name: '往届题目入口' })).toHaveAttribute(
      'href',
      'https://usts.fun/training/20',
    )
    expect(screen.getByRole('link', { name: '往届题目入口' })).toHaveAttribute('target', '_blank')
  })

  it('swipes between school and practice contests and stops at the ends', () => {
    render(
      <MemoryRouter initialEntries={['/contests']}>
        <FreshmanContestPage />
      </MemoryRouter>,
    )

    const contestHero = screen.getByRole('region', { name: '校内赛事' })
    fireEvent.pointerDown(contestHero, { clientX: 180, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 80, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /练习赛/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '练习赛', level: 1 })).toBeInTheDocument()

    fireEvent.pointerDown(contestHero, { clientX: 180, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 80, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /练习赛/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.pointerDown(contestHero, { clientX: 80, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 180, pointerType: 'touch' })

    expect(screen.getByRole('tab', { name: /校赛/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '校赛', level: 1 })).toBeInTheDocument()
    fireEvent.pointerDown(contestHero, { clientX: 80, pointerType: 'touch' })
    fireEvent.pointerUp(contestHero, { clientX: 180, pointerType: 'touch' })
    expect(screen.getByRole('tab', { name: /校赛/ })).toHaveAttribute('aria-selected', 'true')
  })
})
