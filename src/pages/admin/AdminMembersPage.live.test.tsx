import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReviewMember } from '../../types/domain'

const adminMemberMocks = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
  setStatus: vi.fn(),
  syncMember: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminMembers', () => ({
  fetchAdminReviewMembers: adminMemberMocks.fetchMembers,
  setAdminMemberReviewStatus: adminMemberMocks.setStatus,
}))

vi.mock('../../lib/adminImmediateSync', () => ({
  triggerAdminImmediateSync: adminMemberMocks.syncMember,
}))

import { AdminMembersPage } from './AdminMembersPage'

const rejectedMember: ReviewMember = {
  id: 'member-1',
  name: '测试成员',
  major: '计算机科学与技术',
  grade: '24级',
  qq: '123456789',
  email: 'member@example.edu.cn',
  submittedAt: '2026-07-12T12:00:00Z',
  updatedAt: '2026-07-12T12:05:00Z',
  reviewStatus: 'rejected',
  reviewNote: '资料待补充',
  platformCount: 4,
}

describe('AdminMembersPage with Supabase configured', () => {
  beforeEach(() => {
    adminMemberMocks.fetchMembers.mockReset()
    adminMemberMocks.setStatus.mockReset()
    adminMemberMocks.syncMember.mockReset().mockResolvedValue(undefined)
  })

  it('loads live members and restores a rejected member to pending', async () => {
    const user = userEvent.setup()
    adminMemberMocks.fetchMembers.mockResolvedValue([rejectedMember])
    adminMemberMocks.setStatus.mockResolvedValue('2026-07-12T12:06:00Z')

    render(<AdminMembersPage />)

    expect(screen.getByText('实时数据')).toBeInTheDocument()
    const row = await screen.findByRole('row', { name: /测试成员/ })
    expect(within(row).getByText('24级')).toBeInTheDocument()
    expect(within(row).getByText('资料待补充', { exact: false })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '恢复 测试成员 为待审核' }))

    expect(adminMemberMocks.setStatus).toHaveBeenCalledWith(
      'member-1',
      'pending',
      '2026-07-12T12:05:00Z',
      null,
    )
    expect(within(row).getByText('待审核')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('测试成员 已更新为“待审核”')
  })

  it('shows a recoverable error when the live list cannot be loaded', async () => {
    adminMemberMocks.fetchMembers.mockRejectedValue(new Error('成员列表读取失败：无权限'))

    render(<AdminMembersPage />)

    const errorMessage = await screen.findByText('成员列表读取失败：无权限')
    expect(errorMessage).toHaveAttribute('role', 'status')
    expect(screen.getByText('没有匹配的成员')).toBeInTheDocument()
  })

  it('keeps an approved member approved when the first synchronization fails', async () => {
    const user = userEvent.setup()
    adminMemberMocks.fetchMembers.mockResolvedValue([
      {
        ...rejectedMember,
        reviewStatus: 'pending',
        reviewNote: null,
      },
    ])
    adminMemberMocks.setStatus.mockResolvedValue('2026-07-12T12:06:00Z')
    adminMemberMocks.syncMember.mockRejectedValue(new Error('上游暂不可用'))

    render(<AdminMembersPage />)

    const row = await screen.findByRole('row', { name: /测试成员/ })
    await user.click(screen.getByRole('button', { name: '批准 测试成员' }))

    expect(adminMemberMocks.setStatus).toHaveBeenCalledWith(
      'member-1',
      'approved',
      '2026-07-12T12:05:00Z',
      null,
    )
    expect(adminMemberMocks.syncMember).toHaveBeenCalledWith({
      memberId: 'member-1',
      triggerType: 'registration',
    })
    expect(within(row).getByText('已通过')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '测试成员 已更新为“已通过”。 首次同步失败：上游暂不可用。',
    )
    expect(adminMemberMocks.fetchMembers).toHaveBeenCalledTimes(1)
  })
})
