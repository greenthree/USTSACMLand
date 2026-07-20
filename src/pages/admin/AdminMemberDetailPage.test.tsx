import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { mockAdminMemberDetail } from '../../data/mock'

const memberDetailMocks = vi.hoisted(() => ({
  fetchDetail: vi.fn(),
  upsertAccount: vi.fn(),
  unbindAccount: vi.fn(),
  setManualStats: vi.fn(),
  setAccountStatus: vi.fn(),
  triggerSync: vi.fn(),
  fetchWebChatAccess: vi.fn(),
  updateWebChatAccess: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('../../lib/adminMemberDetail', () => ({
  fetchAdminMemberDetail: memberDetailMocks.fetchDetail,
  upsertAdminMemberPlatformAccount: memberDetailMocks.upsertAccount,
  unbindAdminMemberPlatformAccount: memberDetailMocks.unbindAccount,
  setAdminManualPlatformStats: memberDetailMocks.setManualStats,
}))
vi.mock('../../lib/adminPlatformAccounts', () => ({
  setAdminPlatformAccountStatus: memberDetailMocks.setAccountStatus,
}))
vi.mock('../../lib/adminImmediateSync', () => ({
  triggerAdminImmediateSync: memberDetailMocks.triggerSync,
}))
vi.mock('../../lib/webChatMemberAccess', async () => {
  const actual = await vi.importActual<typeof import('../../lib/webChatMemberAccess')>(
    '../../lib/webChatMemberAccess',
  )
  return {
    ...actual,
    fetchAdminWebChatMemberAccess: memberDetailMocks.fetchWebChatAccess,
    updateAdminWebChatMemberAccess: memberDetailMocks.updateWebChatAccess,
  }
})

import { AdminMemberDetailPage } from './AdminMemberDetailPage'

function detailFixture() {
  return structuredClone(mockAdminMemberDetail)
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/members/member-1']}>
      <Routes>
        <Route path="/admin/members/:memberId" element={<AdminMemberDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminMemberDetailPage', () => {
  beforeEach(() => {
    for (const mock of Object.values(memberDetailMocks)) mock.mockReset()
    memberDetailMocks.fetchDetail.mockResolvedValue(detailFixture())
    memberDetailMocks.upsertAccount.mockResolvedValue(undefined)
    memberDetailMocks.unbindAccount.mockResolvedValue(undefined)
    memberDetailMocks.setManualStats.mockResolvedValue(undefined)
    memberDetailMocks.setAccountStatus.mockResolvedValue(undefined)
    memberDetailMocks.triggerSync.mockResolvedValue(undefined)
    memberDetailMocks.fetchWebChatAccess.mockResolvedValue({
      enabled: false,
      totalRequestLimit: 10,
      totalTokenLimit: 40_000,
      version: 1,
      updatedAt: '2026-07-17T08:00:00Z',
    })
    memberDetailMocks.updateWebChatAccess.mockResolvedValue({
      enabled: true,
      totalRequestLimit: 12,
      totalTokenLimit: 50_000,
      version: 2,
      updatedAt: '2026-07-17T09:00:00Z',
    })
  })

  it('shows the member profile, six platforms, and XCPC automatic matching boundary', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: '沈亦安' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(7)
    expect(screen.getByRole('row', { name: /Codeforces/ })).toHaveTextContent('1,712')
    expect(screen.getByRole('row', { name: /牛客/ })).toHaveTextContent('待验证')
    expect(screen.getByRole('row', { name: /XCPC ELO/ })).toHaveTextContent('1,723.5')
    expect(screen.queryByRole('button', { name: '修改 XCPC ELO 账号' })).not.toBeInTheDocument()
  }, 10_000)

  it('edits a platform account with its optimistic-lock timestamp', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    await user.click(screen.getByRole('button', { name: '修改 牛客 账号' }))
    const dialog = screen.getByRole('dialog', { name: '修改 牛客 账号' })
    const input = within(dialog).getByRole('textbox', { name: '平台账号' })
    await user.clear(input)
    await user.type(input, '39841234')
    await user.click(within(dialog).getByRole('button', { name: '保存账号' }))

    expect(memberDetailMocks.upsertAccount).toHaveBeenCalledWith(
      'member-1',
      'nowcoder',
      '39841234',
      '2026-07-13T09:00:00+08:00',
    )
    expect(await screen.findByText('牛客 账号已保存，等待验证。')).toBeInTheDocument()
  })

  it('lets an administrator enable WebChat and set cumulative member limits', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    const enabled = await screen.findByRole('checkbox', { name: /允许使用 AI 学习助手/ })
    const requestLimit = screen.getByRole('spinbutton', { name: /累计请求总上限/ })
    const tokenLimit = screen.getByRole('spinbutton', { name: /累计 Token 总上限/ })
    await user.click(enabled)
    await user.clear(requestLimit)
    await user.type(requestLimit, '12')
    await user.clear(tokenLimit)
    await user.type(tokenLimit, '50000')
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '开放成员权限')
    await user.click(screen.getByRole('button', { name: '保存 AI 助手配置' }))

    expect(memberDetailMocks.updateWebChatAccess).toHaveBeenCalledWith({
      memberId: 'member-1',
      enabled: true,
      totalRequestLimit: 12,
      totalTokenLimit: 50_000,
      expectedVersion: 1,
      reason: '开放成员权限',
    })
    expect(await screen.findByText('成员 AI 助手权限与额度已保存。')).toBeInTheDocument()
    expect(screen.getByText('配置版本 v2')).toBeInTheDocument()
  })

  it('lets an administrator disable AI access without changing cumulative limits', async () => {
    const user = userEvent.setup()
    memberDetailMocks.fetchWebChatAccess.mockResolvedValue({
      enabled: true,
      totalRequestLimit: 12,
      totalTokenLimit: 50_000,
      version: 4,
      updatedAt: '2026-07-17T08:00:00Z',
    })
    memberDetailMocks.updateWebChatAccess.mockResolvedValue({
      enabled: false,
      totalRequestLimit: 12,
      totalTokenLimit: 50_000,
      version: 5,
      updatedAt: '2026-07-17T09:00:00Z',
    })
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    const access = await screen.findByRole('checkbox', { name: /允许使用 AI 学习助手/ })
    expect(access).toBeChecked()

    await user.click(access)
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '关闭该账号权限')
    await user.click(screen.getByRole('button', { name: '保存 AI 助手配置' }))

    expect(memberDetailMocks.updateWebChatAccess).toHaveBeenCalledWith({
      memberId: 'member-1',
      enabled: false,
      totalRequestLimit: 12,
      totalTokenLimit: 50_000,
      expectedVersion: 4,
      reason: '关闭该账号权限',
    })
  })

  it('keeps member platform details available when WebChat access loading fails', async () => {
    memberDetailMocks.fetchWebChatAccess.mockRejectedValue(new Error('授权服务暂时不可用'))
    renderPage()

    expect(await screen.findByRole('heading', { name: '沈亦安' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Codeforces/ })).toBeInTheDocument()
    expect(await screen.findByText('授权服务暂时不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('validates a pending account through the adapter before reporting success', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    await user.click(screen.getByRole('button', { name: '验证 牛客 账号' }))

    expect(memberDetailMocks.setAccountStatus).not.toHaveBeenCalled()
    expect(memberDetailMocks.triggerSync).toHaveBeenCalledWith({
      memberId: 'member-1',
      platforms: ['nowcoder'],
      triggerType: 'account_changed',
    })
    expect(await screen.findByText('牛客 账号已验证并完成首次同步。')).toBeInTheDocument()
  })

  it('validates and submits manual platform data with an audit reason', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    await user.click(screen.getByRole('button', { name: '手工录入 Codeforces 数据' }))
    const dialog = screen.getByRole('dialog', { name: '手工录入 Codeforces 数据' })
    const current = within(dialog).getByRole('spinbutton', { name: '当前 Rating' })
    const maximum = within(dialog).getByRole('spinbutton', { name: '历史最高 Rating' })
    const solved = within(dialog).getByRole('spinbutton', { name: '通过题数' })
    await user.clear(current)
    await user.type(current, '1800')
    await user.clear(maximum)
    await user.type(maximum, '1900')
    await user.clear(solved)
    await user.type(solved, '700')
    await user.type(within(dialog).getByRole('textbox', { name: '录入原因' }), '补录比赛数据')
    await user.click(within(dialog).getByRole('button', { name: '保存手工数据' }))

    expect(memberDetailMocks.setManualStats).toHaveBeenCalledWith(
      'member-1',
      'codeforces',
      expect.objectContaining({
        currentRating: 1800,
        maxRating: 1900,
        solvedCount: 700,
        note: '补录比赛数据',
      }),
      '2026-07-13T08:00:00+08:00',
    )
    expect(await screen.findByText('Codeforces 手工数据已保存。')).toBeInTheDocument()
  })

  it('preserves two decimal places for manually entered XCPC ELO Ratings', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    await user.click(screen.getByRole('button', { name: '手工录入 XCPC ELO 数据' }))
    const dialog = screen.getByRole('dialog', { name: '手工录入 XCPC ELO 数据' })
    const current = within(dialog).getByRole('spinbutton', { name: '当前 Rating' })
    const maximum = within(dialog).getByRole('spinbutton', { name: '历史最高 Rating' })
    expect(current).toHaveAttribute('step', '0.01')
    expect(maximum).toHaveAttribute('step', '0.01')

    await user.clear(current)
    await user.type(current, '1723.5')
    await user.clear(maximum)
    await user.type(maximum, '1801.25')
    await user.type(within(dialog).getByRole('textbox', { name: '录入原因' }), '核对官网小数分')
    await user.click(within(dialog).getByRole('button', { name: '保存手工数据' }))

    expect(memberDetailMocks.setManualStats).toHaveBeenCalledWith(
      'member-1',
      'xcpc_elo',
      expect.objectContaining({
        currentRating: 1723.5,
        maxRating: 1801.25,
        solvedCount: null,
        note: '核对官网小数分',
      }),
      expect.anything(),
    )
  })

  it('rejects XCPC ELO Ratings with more than two decimal places', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })
    await user.click(screen.getByRole('button', { name: '手工录入 XCPC ELO 数据' }))

    const dialog = screen.getByRole('dialog', { name: '手工录入 XCPC ELO 数据' })
    const current = within(dialog).getByRole('spinbutton', { name: '当前 Rating' })
    const maximum = within(dialog).getByRole('spinbutton', { name: '历史最高 Rating' })
    await user.clear(current)
    await user.type(current, '1723.456')
    await user.clear(maximum)
    await user.type(maximum, '1801.25')
    await user.type(within(dialog).getByRole('textbox', { name: '录入原因' }), '测试小数位校验')
    await user.click(within(dialog).getByRole('button', { name: '保存手工数据' }))

    expect(current).toBeInvalid()
    expect(memberDetailMocks.setManualStats).not.toHaveBeenCalled()
  })

  it('rejects a maximum Rating below the current Rating before calling the RPC', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })
    await user.click(screen.getByRole('button', { name: '手工录入 Codeforces 数据' }))

    const dialog = screen.getByRole('dialog', { name: '手工录入 Codeforces 数据' })
    const current = within(dialog).getByRole('spinbutton', { name: '当前 Rating' })
    const maximum = within(dialog).getByRole('spinbutton', { name: '历史最高 Rating' })
    await user.clear(current)
    await user.type(current, '2000')
    await user.clear(maximum)
    await user.type(maximum, '1900')
    await user.type(within(dialog).getByRole('textbox', { name: '录入原因' }), '测试校验')
    await user.click(within(dialog).getByRole('button', { name: '保存手工数据' }))

    expect(
      await within(dialog).findByText('历史最高 Rating 不能低于当前 Rating。'),
    ).toBeInTheDocument()
    expect(memberDetailMocks.setManualStats).not.toHaveBeenCalled()
  })

  it('requires confirmation before deleting an account and its snapshots', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: '沈亦安' })

    await user.click(screen.getByRole('button', { name: '解绑 Codeforces 账号' }))
    const dialog = screen.getByRole('dialog', { name: '解绑 Codeforces 账号' })
    expect(dialog).toHaveTextContent('永久删除该平台的当前统计和全部历史快照')
    await user.click(within(dialog).getByRole('button', { name: '确认解绑' }))

    expect(memberDetailMocks.unbindAccount).toHaveBeenCalledWith(
      'member-1',
      'codeforces',
      '2026-07-13T08:00:00+08:00',
    )
  })
})
