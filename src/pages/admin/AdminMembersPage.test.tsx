import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminMember } from '../../types/domain'

const memberMocks = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
  setSuspension: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminMembers', () => ({
  fetchAdminMembers: memberMocks.fetchMembers,
  setAdminMemberSuspension: memberMocks.setSuspension,
}))

import { AdminMembersPage } from './AdminMembersPage'

const activeMember: AdminMember = {
  id: 'member-1',
  name: '测试成员',
  email: 'member@example.edu.cn',
  qq: '12345678',
  major: '计算机科学与技术',
  grade: '24级',
  status: 'active',
  suspensionNote: null,
  isPublic: true,
  joinedAt: '2026-07-13T09:00:00Z',
  updatedAt: '2026-07-13T10:00:00Z',
  platformCount: 5,
  verifiedPlatformCount: 4,
}

const suspendedMember: AdminMember = {
  ...activeMember,
  id: 'member-2',
  name: '停用成员',
  email: 'suspended@example.edu.cn',
  qq: '87654321',
  status: 'suspended',
  suspensionNote: '已离队',
  isPublic: false,
  updatedAt: '2026-07-13T11:00:00Z',
}

describe('AdminMembersPage with Supabase configured', () => {
  beforeEach(() => {
    memberMocks.fetchMembers.mockReset()
    memberMocks.setSuspension.mockReset()
    memberMocks.fetchMembers.mockResolvedValue([activeMember, suspendedMember])
  })

  it('loads members and filters by private fields and status', async () => {
    const user = userEvent.setup()
    render(<AdminMembersPage />)

    expect(await screen.findByRole('row', { name: /测试成员/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /停用成员/ })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '成员状态' }), 'suspended')
    expect(screen.queryByRole('row', { name: /测试成员/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /停用成员/ })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '成员状态' }), 'all')
    await user.type(screen.getByPlaceholderText('搜索成员、邮箱、QQ、年级或专业'), '12345678')
    expect(screen.getByRole('row', { name: /测试成员/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /停用成员/ })).not.toBeInTheDocument()
  })

  it('confirms suspension with an optional reason and updates the row', async () => {
    const user = userEvent.setup()
    memberMocks.fetchMembers.mockResolvedValue([activeMember])
    memberMocks.setSuspension.mockResolvedValue('2026-07-13T12:00:00Z')
    render(<AdminMembersPage />)

    const row = await screen.findByRole('row', { name: /测试成员/ })
    await user.click(screen.getByRole('button', { name: '停用 测试成员' }))

    const dialog = screen.getByRole('dialog', { name: '停用 测试成员' })
    expect(dialog).toHaveTextContent('仍可登录查看公开页面')
    await user.type(within(dialog).getByRole('textbox', { name: '停用原因（可选）' }), '暂时离队')
    await user.click(within(dialog).getByRole('button', { name: '确认停用' }))

    expect(memberMocks.setSuspension).toHaveBeenCalledWith(
      'member-1',
      true,
      '2026-07-13T10:00:00Z',
      '暂时离队',
    )
    expect(await within(row).findByText('已停用')).toBeInTheDocument()
    expect(within(row).getByText('停用原因：暂时离队')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('测试成员 已停用。')
  })

  it('restores a suspended member without reintroducing approval', async () => {
    const user = userEvent.setup()
    memberMocks.fetchMembers.mockResolvedValue([suspendedMember])
    memberMocks.setSuspension.mockResolvedValue('2026-07-13T12:30:00Z')
    render(<AdminMembersPage />)

    const row = await screen.findByRole('row', { name: /停用成员/ })
    await user.click(screen.getByRole('button', { name: '恢复 停用成员' }))

    expect(memberMocks.setSuspension).toHaveBeenCalledWith(
      'member-2',
      false,
      '2026-07-13T11:00:00Z',
      null,
    )
    expect(await within(row).findByText('正常')).toBeInTheDocument()
    expect(within(row).queryByText('停用原因：已离队')).not.toBeInTheDocument()
  })

  it('shows a protected empty state when the live list fails', async () => {
    memberMocks.fetchMembers.mockRejectedValue(new Error('成员列表读取失败：无权限'))
    render(<AdminMembersPage />)

    expect(await screen.findByText('成员列表读取失败：无权限')).toHaveAttribute('role', 'status')
    expect(screen.getByText('没有匹配的成员')).toBeInTheDocument()
  })

  it('keeps keyboard focus inside the suspension dialog and restores it on close', async () => {
    const user = userEvent.setup()
    memberMocks.fetchMembers.mockResolvedValue([activeMember])
    render(<AdminMembersPage />)

    await screen.findByRole('row', { name: /测试成员/ })
    const trigger = screen.getByRole('button', { name: '停用 测试成员' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '停用 测试成员' })
    const closeButton = within(dialog).getByRole('button', { name: '关闭停用成员对话框' })
    const confirmButton = within(dialog).getByRole('button', { name: '确认停用' })
    closeButton.focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(confirmButton)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
