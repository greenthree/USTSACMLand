import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { MembersDataContext } from '../data/membersDataContext'
import { mockMembers } from '../data/mock'
import {
  currentBeijingDate,
  formatPracticeDateRange,
  practicePresetRange,
  type PracticeIncrementRecord,
} from '../lib/practiceIncrements'
import { solvedPlatforms } from '../lib/platforms'
import type { Member } from '../types/domain'
import { RankingsPage } from './RankingsPage'

const incrementMocks = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('../data/practiceIncrementRankings', () => ({
  loadPublicPracticeIncrements: incrementMocks.load,
}))

function createPaginatedMembers(count: number): Member[] {
  return Array.from({ length: count }, (_, index) => {
    const member = structuredClone(mockMembers[0]) as Member
    const order = index + 1
    member.id = `pagination-member-${order}`
    member.name = `分页成员${String(order).padStart(2, '0')}`
    member.major = order > 30 ? '软件工程' : '计算机科学与技术'
    member.grade = order % 2 === 0 ? '24级' : '23级'
    Object.values(member.stats).forEach((stat) => {
      stat.externalId = `pagination-${order}`
      stat.rating = 3001 - order
      stat.peakRating = 3101 - order
      stat.solved = 10001 - order
    })
    return member
  })
}

function renderWithMembers(members: Member[], demo = true) {
  return render(
    <MemoryRouter>
      <MembersDataContext.Provider value={{ members, loading: false, error: null, demo }}>
        <RankingsPage />
      </MembersDataContext.Provider>
    </MemoryRouter>,
  )
}

function createIncrementRecords(members: Member[]): PracticeIncrementRecord[] {
  return members.flatMap((member, memberIndex) =>
    solvedPlatforms.map((platform, platformIndex) => {
      const endCount = member.stats[platform].solved
      const delta = endCount === null ? null : memberIndex * 10 + platformIndex + 1
      return {
        memberId: member.id,
        platform,
        delta,
        baselineCount: endCount === null || delta === null ? null : endCount - delta,
        endCount,
        baselineAt: endCount === null ? null : '2026-07-12T19:00:00+08:00',
        endAt: endCount === null ? null : '2026-07-18T07:00:00+08:00',
        coverageStatus: endCount === null ? ('missing_baseline' as const) : ('complete' as const),
      }
    }),
  )
}

describe('RankingsPage', () => {
  beforeEach(() => {
    incrementMocks.load.mockReset()
    incrementMocks.load.mockResolvedValue(createIncrementRecords(mockMembers))
  })

  it('switches between rating and solved rankings', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Rating 榜' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rating 榜' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('tab', { name: '总榜' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('columnheader', { name: '总 Rating' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '总历史最高 Rating' })).toBeInTheDocument()
    const ratingLeader = screen.getByRole('row', { name: /周知行/ })
    expect(within(ratingLeader).getByText('1,752.41')).toBeInTheDocument()
    expect(within(ratingLeader).getByText('1,771.35')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刷题榜' }))
    expect(screen.getByRole('heading', { name: '刷题榜' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷题榜' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: '总榜' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '总榜',
      'Codeforces',
      '牛客',
      'AtCoder',
      '洛谷',
      'QOJ',
    ])
    expect(screen.getByRole('columnheader', { name: '总通过题数' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '排名',
      '成员',
      '专业',
      '总通过题数',
      'Codeforces',
      '牛客',
      'AtCoder',
      '洛谷',
      'QOJ',
    ])
    const solvedLeader = screen.getByRole('row', { name: /顾明远/ })
    expect(within(solvedLeader).getByText('4,165')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'AtCoder' }))
    expect(screen.getByText('mingyuan_g')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /顾明远/ })).getByText('602')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Codeforces' }))
    expect(screen.getByRole('columnheader', { name: '平台账号' })).toBeInTheDocument()
    expect(screen.getByText('MingYuanGu')).toBeInTheDocument()
  }, 10_000)

  it('switches between cumulative, weekly, monthly and custom practice ranges', async () => {
    const user = userEvent.setup()
    renderWithMembers(mockMembers, false)
    const today = currentBeijingDate()
    const week = practicePresetRange('week', today)
    const month = practicePresetRange('month', today)

    await user.click(screen.getByRole('button', { name: '刷题榜' }))
    expect(screen.getByRole('button', { name: '累计总数' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: '总通过题数' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '本周' }))
    expect(await screen.findByRole('heading', { name: '刷题增量榜' })).toBeInTheDocument()
    await waitFor(() =>
      expect(incrementMocks.load).toHaveBeenLastCalledWith(week, expect.any(AbortSignal)),
    )
    expect(screen.getByText(formatPracticeDateRange(week))).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '区间新增题数' })).toBeInTheDocument()
    expect(screen.getAllByText('5/5 个平台').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: 'Codeforces' }))
    expect(screen.getByRole('columnheader', { name: '新增通过题数' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '区间末累计' })).toBeInTheDocument()
    expect(screen.getAllByText('统计完整').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '本月' }))
    await waitFor(() =>
      expect(incrementMocks.load).toHaveBeenLastCalledWith(month, expect.any(AbortSignal)),
    )
    expect(await screen.findByText(formatPracticeDateRange(month))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '自定义' }))
    const startInput = screen.getByLabelText('开始日期')
    const endInput = screen.getByLabelText('结束日期')
    await user.clear(startInput)
    await user.type(startInput, today)
    await user.clear(endInput)
    await user.type(endInput, week.startDate)
    await user.click(screen.getByRole('button', { name: '应用范围' }))
    expect(screen.getByRole('alert')).toHaveTextContent('开始日期不能晚于结束日期。')

    await user.clear(endInput)
    await user.type(endInput, today)
    await user.click(screen.getByRole('button', { name: '应用范围' }))
    await waitFor(() =>
      expect(incrementMocks.load).toHaveBeenLastCalledWith(
        { startDate: today, endDate: today },
        expect.any(AbortSignal),
      ),
    )

    await user.click(screen.getByRole('button', { name: '累计总数' }))
    expect(screen.getByRole('heading', { name: '刷题榜' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '通过题数' })).toBeInTheDocument()
  }, 15_000)

  it('activates ranking modes and platform tabs from the keyboard', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>,
    )

    const solvedMode = screen.getByRole('button', { name: '刷题榜' })
    solvedMode.focus()
    await user.keyboard('{Enter}')

    expect(solvedMode).toHaveFocus()
    expect(solvedMode).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '刷题榜' })).toBeInTheDocument()

    const overall = screen.getByRole('tab', { name: '总榜' })
    overall.focus()
    await user.keyboard('{End}')

    const qoj = screen.getByRole('tab', { name: 'QOJ' })
    expect(qoj).toHaveFocus()
    expect(qoj).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('columnheader', { name: '平台账号' })).toBeInTheDocument()
  })

  it('filters members by name', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>,
    )

    const search = screen.getByPlaceholderText('搜索成员')
    await user.type(search, 'zhixing_usts')
    expect(await screen.findByRole('row', { name: /周知行/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /顾明远/ })).not.toBeInTheDocument()

    await user.clear(search)
    await user.selectOptions(screen.getByRole('combobox', { name: '专业筛选' }), '通信工程')
    const filteredMember = await screen.findByRole('row', { name: /赵清和/ })
    expect(within(filteredMember).getByText('921.23')).toBeInTheDocument()
  })

  it('filters by grade together with the other conditions', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>,
    )

    const gradeFilter = screen.getByRole('combobox', { name: '年级筛选' })
    expect(gradeFilter).toHaveValue('全部年级')
    expect(
      within(gradeFilter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['全部年级', '25级', '24级', '23级'])

    await user.selectOptions(gradeFilter, '25级')
    expect(screen.getByRole('row', { name: /陆星野/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /赵清和/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /周知行/ })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '专业筛选' }), '通信工程')
    const memberRow = screen.getByRole('row', { name: /赵清和/ })
    expect(within(memberRow).getByText('25级')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /陆星野/ })).not.toBeInTheDocument()

    const search = screen.getByRole('textbox', { name: '搜索成员' })
    await user.type(search, 'QingheZ')
    expect(screen.getByRole('row', { name: /赵清和/ })).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'XingyeLu')
    expect(screen.getByText('没有匹配的成员')).toBeInTheDocument()
  })

  it('shows member names instead of internal IDs on the XCPC ELO ranking', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('tab', { name: 'XCPC ELO' }))

    expect(screen.getByRole('columnheader', { name: '匹配姓名' })).toBeInTheDocument()
    const memberRow = screen.getByRole('row', { name: /周知行/ })
    expect(within(memberRow).getAllByText('周知行')).toHaveLength(2)
    expect(screen.queryByText('xcpc_41382a9bc0de127f')).not.toBeInTheDocument()
  })

  it('paginates the overall ranking with global ranks and resets after filtering', async () => {
    const user = userEvent.setup()
    renderWithMembers(createPaginatedMembers(60))

    expect(screen.getByText('共 60 名 · 第 1 / 3 页')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26)
    expect(
      within(screen.getByRole('row', { name: /分页成员01/ })).getByText('1', {
        selector: '.rank-number',
      }),
    ).toHaveClass('rank-1')

    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByText('共 60 名 · 第 2 / 3 页')).toBeInTheDocument()
    const secondPageFirstRow = screen.getByRole('row', { name: /分页成员26/ })
    expect(within(secondPageFirstRow).getByText('26')).toHaveClass('rank-number')
    expect(within(secondPageFirstRow).getByText('26')).not.toHaveClass('rank-1')
    expect(screen.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')

    await user.type(screen.getByRole('textbox', { name: '搜索成员' }), '分页成员30')

    expect(await screen.findByText('共 1 名 · 第 1 / 1 页')).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /分页成员30/ })).getByText('1', {
        selector: '.rank-number',
      }),
    ).toHaveClass('rank-1')
    expect(screen.queryByRole('button', { name: '上一页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  })

  it('resets pagination for page size, platform and ranking mode changes', async () => {
    const user = userEvent.setup()
    renderWithMembers(createPaginatedMembers(60))

    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('共 60 名 · 第 2 / 3 页')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '每页显示人数' }), '50')
    expect(screen.getByText('共 60 名 · 第 1 / 2 页')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(51)

    await user.click(screen.getByRole('button', { name: '下一页' }))
    await user.click(screen.getByRole('tab', { name: 'Codeforces' }))
    expect(screen.getByText('共 60 名 · 第 1 / 2 页')).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /分页成员01/ })).getByText('1', {
        selector: '.rank-number',
      }),
    ).toHaveClass('rank-1')

    await user.click(screen.getByRole('button', { name: '下一页' }))
    const platformSecondPageFirstRow = screen.getByRole('row', { name: /分页成员51/ })
    expect(within(platformSecondPageFirstRow).getByText('51')).toHaveClass('rank-number')

    await user.click(screen.getByRole('button', { name: '刷题榜' }))
    expect(screen.getByText('共 60 名 · 第 1 / 2 页')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '总榜' })).toHaveAttribute('aria-selected', 'true')
  }, 10_000)

  it('keeps page buttons compact with accessible ellipses', async () => {
    const user = userEvent.setup()
    renderWithMembers(createPaginatedMembers(225))

    const pagination = screen.getByRole('navigation', { name: '榜单分页' })
    const pageGroup = within(pagination).getByRole('group', { name: '页码' })
    expect(
      within(pageGroup)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['1', '2', '3', '4', '5', '9'])
    expect(within(pageGroup).getByText('…')).toHaveAttribute('aria-hidden', 'true')

    await user.click(within(pageGroup).getByRole('button', { name: '第 5 页' }))

    expect(screen.getByText('共 225 名 · 第 5 / 9 页')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Rating榜结果' })).toHaveFocus()
    expect(
      within(pageGroup)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['1', '4', '5', '6', '9'])
    expect(within(pageGroup).getAllByText('…')).toHaveLength(2)
    expect(within(pageGroup).getByRole('button', { name: '第 5 页' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('normalizes the current page when the available member count shrinks', async () => {
    const user = userEvent.setup()
    const view = renderWithMembers(createPaginatedMembers(60))

    await user.click(screen.getByRole('button', { name: '第 3 页' }))
    expect(screen.getByText('共 60 名 · 第 3 / 3 页')).toBeInTheDocument()

    view.rerender(
      <MemoryRouter>
        <MembersDataContext.Provider
          value={{
            members: createPaginatedMembers(30),
            loading: false,
            error: null,
            demo: true,
          }}
        >
          <RankingsPage />
        </MembersDataContext.Provider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('共 30 名 · 第 2 / 2 页')).toBeInTheDocument()

    view.rerender(
      <MemoryRouter>
        <MembersDataContext.Provider
          value={{
            members: createPaginatedMembers(60),
            loading: false,
            error: null,
            demo: true,
          }}
        >
          <RankingsPage />
        </MembersDataContext.Provider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('共 60 名 · 第 2 / 3 页')).toBeInTheDocument()
  })
})
