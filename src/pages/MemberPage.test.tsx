import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { mockMembers } from '../data/mock'

const memberPageMocks = vi.hoisted(() => ({
  membersData: vi.fn(),
  trends: vi.fn(),
}))

vi.mock('../data/useMembersData', () => ({
  useMembersData: memberPageMocks.membersData,
}))

vi.mock('../data/useMemberRatingTrends', () => ({
  useMemberRatingTrends: memberPageMocks.trends,
}))

import { MemberPage } from './MemberPage'

function renderPage(memberId = mockMembers[0].id) {
  return render(
    <MemoryRouter initialEntries={[`/members/${memberId}`]}>
      <Routes>
        <Route path="/members/:memberId" element={<MemberPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MemberPage data states', () => {
  beforeEach(() => {
    memberPageMocks.membersData.mockReset().mockReturnValue({
      members: mockMembers,
      loading: false,
      error: null,
      demo: true,
    })
    memberPageMocks.trends.mockReset().mockReturnValue({
      snapshots: [],
      loading: false,
      error: null,
      demo: true,
    })
  })

  it('waits for the member directory before deciding that a member is missing', () => {
    memberPageMocks.membersData.mockReturnValue({
      members: [],
      loading: true,
      error: null,
      demo: false,
    })

    renderPage('member-1')

    expect(screen.getByText('正在读取成员资料')).toBeInTheDocument()
    expect(screen.queryByText('成员不存在')).not.toBeInTheDocument()
  })

  it('distinguishes a failed public directory from a genuinely missing member', () => {
    memberPageMocks.membersData.mockReturnValue({
      members: [],
      loading: false,
      error: '公共榜单加载失败',
      demo: true,
    })

    renderPage('member-1')

    expect(screen.getByText('成员资料暂不可用')).toBeInTheDocument()
    expect(screen.getByText('公开成员数据读取失败，请稍后刷新重试。')).toBeInTheDocument()
  })

  it('shows a fallback warning without hiding a matching demonstration profile', () => {
    memberPageMocks.membersData.mockReturnValue({
      members: mockMembers,
      loading: false,
      error: '公共榜单加载失败',
      demo: true,
    })

    renderPage()

    expect(screen.getByRole('heading', { name: mockMembers[0].name })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('当前展示演示数据')
  })

  it('keeps the normal not-found state when the directory loaded successfully', () => {
    renderPage('missing-member')

    expect(screen.getByText('成员不存在')).toBeInTheDocument()
    expect(screen.queryByText('成员资料暂不可用')).not.toBeInTheDocument()
  })
})
