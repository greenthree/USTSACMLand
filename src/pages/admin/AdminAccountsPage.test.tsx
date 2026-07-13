import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminPlatformAccount } from '../../types/domain'

const adminAccountMocks = vi.hoisted(() => ({
  fetchAccounts: vi.fn(),
  setStatus: vi.fn(),
  syncMember: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminPlatformAccounts', () => ({
  fetchAdminPlatformAccounts: adminAccountMocks.fetchAccounts,
  setAdminPlatformAccountStatus: adminAccountMocks.setStatus,
}))

vi.mock('../../lib/adminImmediateSync', () => ({
  triggerAdminImmediateSync: adminAccountMocks.syncMember,
}))

import { AdminAccountsPage } from './AdminAccountsPage'

const pendingAccount: AdminPlatformAccount = {
  id: 42,
  profileId: 'member-1',
  memberName: '测试成员',
  major: '计算机科学与技术',
  email: 'member@example.edu.cn',
  platform: 'luogu',
  externalId: '409073',
  status: 'pending',
  verifiedAt: null,
  verificationErrorCode: null,
  verificationErrorMessage: null,
  updatedAt: '2026-07-13T12:00:00Z',
}

describe('AdminAccountsPage with Supabase configured', () => {
  beforeEach(() => {
    adminAccountMocks.fetchAccounts.mockReset()
    adminAccountMocks.setStatus.mockReset()
    adminAccountMocks.syncMember.mockReset().mockResolvedValue(undefined)
  })

  it('requires an invalid reason and submits the optimistic-lock timestamp', async () => {
    const user = userEvent.setup()
    const invalidAccount = {
      ...pendingAccount,
      status: 'invalid' as const,
      verificationErrorCode: 'invalid_account',
      verificationErrorMessage: '用户不存在',
      updatedAt: '2026-07-13T12:01:00Z',
    }
    adminAccountMocks.fetchAccounts
      .mockResolvedValueOnce([pendingAccount])
      .mockResolvedValueOnce([invalidAccount])
    adminAccountMocks.setStatus.mockResolvedValue(undefined)

    render(<AdminAccountsPage />)

    const row = await screen.findByRole('row', { name: /测试成员/ })
    await user.click(screen.getByRole('button', { name: '标记 测试成员 的 洛谷 账号无效' }))

    const dialog = screen.getByRole('dialog', { name: '标记 测试成员 的 洛谷 账号无效' })
    const confirmButton = within(dialog).getByRole('button', { name: '确认无效' })
    expect(confirmButton).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: '无效原因' }), '用户不存在')
    await user.click(confirmButton)

    expect(adminAccountMocks.setStatus).toHaveBeenCalledWith(
      42,
      'invalid',
      '用户不存在',
      '2026-07-13T12:00:00Z',
    )
    expect(await within(row).findByText('无效')).toBeInTheDocument()
    expect(within(row).getByText('用户不存在')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('测试成员 的 洛谷 账号已更新为“无效”')
  })

  it('filters live rows by platform and verification status', async () => {
    const user = userEvent.setup()
    adminAccountMocks.fetchAccounts.mockResolvedValue([
      pendingAccount,
      {
        ...pendingAccount,
        id: 43,
        memberName: '另一成员',
        platform: 'codeforces',
        externalId: 'OtherMember',
        status: 'verified',
        verifiedAt: '2026-07-13T11:00:00Z',
      },
    ])

    render(<AdminAccountsPage />)

    await screen.findByRole('row', { name: /测试成员/ })
    await user.selectOptions(screen.getByRole('combobox', { name: '平台' }), 'codeforces')
    await user.selectOptions(screen.getByRole('combobox', { name: '账号状态' }), 'verified')

    expect(screen.getByRole('row', { name: /另一成员/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /测试成员/ })).not.toBeInTheDocument()
  })

  it('requires confirmation before disabling an account', async () => {
    const user = userEvent.setup()
    const disabledAccount = {
      ...pendingAccount,
      status: 'disabled' as const,
      updatedAt: '2026-07-13T12:02:00Z',
    }
    adminAccountMocks.fetchAccounts
      .mockResolvedValueOnce([pendingAccount])
      .mockResolvedValueOnce([disabledAccount])
    adminAccountMocks.setStatus.mockResolvedValue(undefined)

    render(<AdminAccountsPage />)

    await screen.findByRole('row', { name: /测试成员/ })
    await user.click(screen.getByRole('button', { name: '停用 测试成员 的 洛谷 账号' }))

    expect(adminAccountMocks.setStatus).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '停用 测试成员 的 洛谷 账号' })
    await user.click(within(dialog).getByRole('button', { name: '确认停用' }))

    expect(adminAccountMocks.setStatus).toHaveBeenCalledWith(
      42,
      'disabled',
      null,
      '2026-07-13T12:00:00Z',
    )
    const updatedRow = await screen.findByRole('row', { name: /测试成员/ })
    expect(within(updatedRow).getByText('已停用')).toBeInTheDocument()
  })

  it('shows XCPC ELO as an automatic match without manual review actions', async () => {
    adminAccountMocks.fetchAccounts.mockResolvedValue([
      {
        ...pendingAccount,
        id: 44,
        platform: 'xcpc_elo',
        externalId: 'xcpc_41382a9bc0de127f',
      },
    ])

    render(<AdminAccountsPage />)

    const row = await screen.findByRole('row', { name: /测试成员/ })
    expect(within(row).getByText('按姓名自动匹配')).toBeInTheDocument()
    expect(within(row).getByText('内部 ID：xcpc_41382a9bc0de127f')).toBeInTheDocument()
    expect(within(row).getByText('同步服务自动维护')).toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(adminAccountMocks.setStatus).not.toHaveBeenCalled()
  })

  it('keeps a verified account verified when its first synchronization fails', async () => {
    const user = userEvent.setup()
    const verifiedAccount = {
      ...pendingAccount,
      status: 'verified' as const,
      verifiedAt: '2026-07-13T12:02:00Z',
      updatedAt: '2026-07-13T12:02:00Z',
    }
    adminAccountMocks.fetchAccounts
      .mockResolvedValueOnce([pendingAccount])
      .mockResolvedValueOnce([verifiedAccount])
    adminAccountMocks.setStatus.mockResolvedValue(undefined)
    adminAccountMocks.syncMember.mockRejectedValue(new Error('上游暂不可用'))

    render(<AdminAccountsPage />)

    const row = await screen.findByRole('row', { name: /测试成员/ })
    await user.click(screen.getByRole('button', { name: '验证 测试成员 的 洛谷 账号' }))

    expect(adminAccountMocks.setStatus).toHaveBeenCalledWith(
      42,
      'verified',
      null,
      '2026-07-13T12:00:00Z',
    )
    expect(adminAccountMocks.syncMember).toHaveBeenCalledWith({
      memberId: 'member-1',
      platforms: ['luogu'],
      triggerType: 'account_changed',
    })
    expect(await within(row).findByText('已验证')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '测试成员 的 洛谷 账号已更新为“已验证”。 首次同步失败：上游暂不可用。',
    )
  })

  it('shows the loading failure and an empty recovery state', async () => {
    adminAccountMocks.fetchAccounts.mockRejectedValue(new Error('平台账号列表读取失败：无权限'))

    render(<AdminAccountsPage />)

    const errorMessage = await screen.findByText('平台账号列表读取失败：无权限')
    expect(errorMessage).toHaveAttribute('role', 'status')
    expect(screen.getByText('没有匹配的平台账号')).toBeInTheDocument()
  })
})
