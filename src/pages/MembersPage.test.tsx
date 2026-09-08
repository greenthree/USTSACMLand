import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { mockMembers } from '../data/mock'

const membersPageMocks = vi.hoisted(() => ({
  membersData: vi.fn(),
}))

vi.mock('../data/useMembersData', () => ({
  useMembersData: membersPageMocks.membersData,
}))

import { MembersPage } from './MembersPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/members']}>
      <MembersPage />
    </MemoryRouter>,
  )
}

describe('MembersPage', () => {
  beforeEach(() => {
    membersPageMocks.membersData.mockReset().mockReturnValue({
      members: mockMembers,
      loading: false,
      error: null,
      demo: true,
    })
  })

  it('shows loading state while initial members data is loading', () => {
    membersPageMocks.membersData.mockReturnValue({
      members: [],
      loading: true,
      error: null,
      demo: false,
    })

    renderPage()

    expect(screen.getByText('正在读取成员列表')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: mockMembers[0].name })).not.toBeInTheDocument()
  })

  it('renders the list of members when data is loaded', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '成员' })).toBeInTheDocument()
    expect(screen.getByText(mockMembers[0].name)).toBeInTheDocument()
  })

  it('filters member list by search keyword', async () => {
    const user = userEvent.setup()
    renderPage()

    const searchInput = screen.getByPlaceholderText('搜索成员、专业或年级')
    await user.type(searchInput, mockMembers[0].name)

    expect(screen.getByText(mockMembers[0].name)).toBeInTheDocument()
  })

  it('renders empty state when search query matches no member', async () => {
    const user = userEvent.setup()
    renderPage()

    const searchInput = screen.getByPlaceholderText('搜索成员、专业或年级')
    await user.type(searchInput, '非真实存在之测试选手')

    expect(screen.getByText('未找到匹配成员')).toBeInTheDocument()
    expect(screen.getByText('尝试使用其他姓名、专业或年级关键词重新搜索。')).toBeInTheDocument()
  })

  it('renders empty state when members data failed to load', () => {
    membersPageMocks.membersData.mockReturnValue({
      members: [],
      loading: false,
      error: '网络请求失败',
      demo: false,
    })

    renderPage()

    expect(screen.getByText('成员列表暂不可用')).toBeInTheDocument()
    expect(screen.getByText('公开成员数据读取失败，请稍后刷新重试。')).toBeInTheDocument()
  })
})
