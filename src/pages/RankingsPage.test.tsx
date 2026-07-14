import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RankingsPage } from './RankingsPage'

describe('RankingsPage', () => {
  it('switches between rating and solved rankings', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Rating 榜' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '总榜' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('columnheader', { name: '总 Rating' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '总历史最高 Rating' })).toBeInTheDocument()
    const ratingLeader = screen.getByRole('row', { name: /周知行/ })
    expect(within(ratingLeader).getByText('1,752.41')).toBeInTheDocument()
    expect(within(ratingLeader).getByText('1,771.35')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刷题榜' }))
    expect(screen.getByRole('heading', { name: '刷题榜' })).toBeInTheDocument()
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
})
