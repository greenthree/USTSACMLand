import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import { loadAccountDraft } from '../lib/accountDraft'
import type { ReferralSummary } from '../lib/referrals'

const accountMocks = vi.hoisted(() => ({
  accountsSelectEq: vi.fn(),
  accountsUpsert: vi.fn(),
  accountsDeleteIn: vi.fn(),
  from: vi.fn(),
  invoke: vi.fn(),
  profileSingle: vi.fn(),
  profileUpdate: vi.fn(),
  profileUpdateEq: vi.fn(),
}))

const personalExportMocks = vi.hoisted(() => ({
  buildDemo: vi.fn(),
  download: vi.fn(),
  fetch: vi.fn(),
}))

const referralMocks = vi.hoisted(() => ({
  buildUrl: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: accountMocks.from,
    functions: { invoke: accountMocks.invoke },
  },
}))

vi.mock('../lib/personalDataExport', () => ({
  buildDemoPersonalDataExport: personalExportMocks.buildDemo,
  downloadPersonalDataExport: personalExportMocks.download,
  fetchOwnPersonalDataExport: personalExportMocks.fetch,
}))

vi.mock('../lib/referrals', () => ({
  buildReferralRegistrationUrl: referralMocks.buildUrl,
  fetchOwnReferralSummary: referralMocks.fetch,
}))

import { AccountPage } from './AccountPage'

const authValue: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: 'member-1',
    email: 'member@example.edu.cn',
    role: 'member',
    reviewStatus: 'approved',
  },
  isDemo: false,
  isPasswordRecovery: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  changePassword: vi.fn(),
  completePasswordRecovery: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
}

const adminAuthValue: AuthContextValue = {
  ...authValue,
  user: {
    ...authValue.user!,
    role: 'admin',
  },
}

const xcpcAccount = {
  platform: 'xcpc_elo',
  external_id: 'auto:1234567890abcdef1234567890abcdef',
  status: 'pending',
  verification_error_message: null,
}

function renderAccountPage(value = authValue) {
  return render(
    <AuthContext.Provider value={value}>
      <AccountPage />
    </AuthContext.Provider>,
  )
}

describe('AccountPage XCPC ELO automatic matching', () => {
  beforeEach(() => {
    localStorage.clear()
    accountMocks.accountsSelectEq.mockReset()
    accountMocks.accountsUpsert.mockReset()
    accountMocks.accountsDeleteIn.mockReset()
    accountMocks.from.mockReset()
    accountMocks.invoke.mockReset()
    vi.mocked(authValue.changePassword).mockReset()
    vi.mocked(authValue.deleteAccount).mockReset()
    accountMocks.profileSingle.mockReset()
    accountMocks.profileUpdate.mockReset()
    accountMocks.profileUpdateEq.mockReset()
    personalExportMocks.buildDemo.mockReset()
    personalExportMocks.download.mockReset()
    personalExportMocks.fetch.mockReset()
    referralMocks.buildUrl
      .mockReset()
      .mockReturnValue('https://ustsacm.fun/register?invite=8A4C19F2E7B603D5')
    referralMocks.fetch.mockReset().mockResolvedValue({
      programEnabled: true,
      code: '8A4C19F2E7B603D5',
      rewardCount: 2,
      remainingRewards: 8,
      rewardTokens: 2_000_000,
      available: true,
    })

    accountMocks.profileSingle.mockResolvedValue({
      data: {
        full_name: '测试成员',
        qq: '12345678',
        major: '计算机科学与技术',
        grade: '24级',
      },
      error: null,
    })
    accountMocks.accountsSelectEq.mockResolvedValue({ data: [xcpcAccount], error: null })
    accountMocks.profileUpdateEq.mockResolvedValue({ error: null })
    accountMocks.profileUpdate.mockImplementation(() => ({ eq: accountMocks.profileUpdateEq }))
    accountMocks.accountsUpsert.mockResolvedValue({ error: null })
    accountMocks.accountsDeleteIn.mockResolvedValue({ error: null })
    accountMocks.invoke.mockResolvedValue({ error: null })
    personalExportMocks.fetch.mockResolvedValue({ schemaVersion: 1 })
    personalExportMocks.download.mockReturnValue(
      'usts-acm-land-personal-data_2026-07-19_05-06-07-890Z.json',
    )

    accountMocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ single: accountMocks.profileSingle }),
          }),
          update: accountMocks.profileUpdate,
        }
      }

      if (table === 'platform_accounts') {
        return {
          select: () => ({ eq: accountMocks.accountsSelectEq }),
          upsert: accountMocks.accountsUpsert,
          delete: () => ({
            eq: () => ({ in: accountMocks.accountsDeleteIn }),
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })
  })

  it('shows a read-only name match without manual synchronization for members', async () => {
    renderAccountPage()

    expect(
      await screen.findByText(
        '牛客和洛谷填写 UID（个人主页链接最后的一串数字）；XCPC ELO 使用姓名和学校自动匹配。',
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText('按「姓名 + 苏州科技大学」自动匹配')).toBeInTheDocument()
    expect(screen.queryByLabelText('XCPC ELO 账号')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '立即同步' })).not.toBeInTheDocument()
    expect(accountMocks.invoke).not.toHaveBeenCalled()
  })

  it('shows the own referral summary and copies the registration link', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderAccountPage()

    expect(await screen.findByText('8A4C19F2E7B603D5')).toBeInTheDocument()
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
    expect(screen.getByText('2,000,000')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制注册链接' }))

    expect(referralMocks.buildUrl).toHaveBeenCalledWith('8A4C19F2E7B603D5')
    expect(writeText).toHaveBeenCalledWith('https://ustsacm.fun/register?invite=8A4C19F2E7B603D5')
    expect(screen.getByText('邀请码注册链接已复制。')).toBeInTheDocument()
  })

  it('disables sharing after all ten referral rewards are used', async () => {
    referralMocks.fetch.mockResolvedValueOnce({
      programEnabled: true,
      code: '8A4C19F2E7B603D5',
      rewardCount: 10,
      remainingRewards: 0,
      rewardTokens: 10_000_000,
      available: false,
    })
    renderAccountPage()

    expect(await screen.findByText('10 / 10')).toBeInTheDocument()
    expect(screen.getByText('当前邀请码已达到邀请上限，暂不可继续使用。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制注册链接' })).toBeDisabled()
  })

  it('hides the code while preserving historical rewards when the program is paused', async () => {
    referralMocks.fetch.mockResolvedValueOnce({
      programEnabled: false,
      code: null,
      rewardCount: 3,
      remainingRewards: 7,
      rewardTokens: 3_000_000,
      available: false,
    })
    renderAccountPage()

    expect(await screen.findByText('3 / 10')).toBeInTheDocument()
    expect(screen.getByText('3,000,000')).toBeInTheDocument()
    expect(screen.queryByText('我的邀请码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制注册链接' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '推荐计划已暂停。邀请码和既有奖励已保留，重新开放后继续使用。',
    )
    expect(screen.queryByText('当前邀请码已达到邀请上限，暂不可继续使用。')).not.toBeInTheDocument()
  })

  it('refreshes the program state before copying a referral link', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    referralMocks.fetch
      .mockResolvedValueOnce({
        programEnabled: true,
        code: '8A4C19F2E7B603D5',
        rewardCount: 2,
        remainingRewards: 8,
        rewardTokens: 2_000_000,
        available: true,
      })
      .mockResolvedValueOnce({
        programEnabled: false,
        code: null,
        rewardCount: 2,
        remainingRewards: 8,
        rewardTokens: 2_000_000,
        available: false,
      })
    renderAccountPage()

    await user.click(await screen.findByRole('button', { name: '复制注册链接' }))

    expect(referralMocks.fetch).toHaveBeenCalledTimes(2)
    expect(writeText).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('推荐计划已暂停')
  })

  it('does not copy a stale referral result when a newer refresh observes a pause', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    let resolveCopyRefresh: (summary: ReferralSummary) => void = () => undefined
    const copyRefresh = new Promise<ReferralSummary>((resolve) => {
      resolveCopyRefresh = resolve
    })
    referralMocks.fetch
      .mockResolvedValueOnce({
        programEnabled: true,
        code: '8A4C19F2E7B603D5',
        rewardCount: 2,
        remainingRewards: 8,
        rewardTokens: 2_000_000,
        available: true,
      })
      .mockReturnValueOnce(copyRefresh)
      .mockResolvedValueOnce({
        programEnabled: false,
        code: null,
        rewardCount: 2,
        remainingRewards: 8,
        rewardTokens: 2_000_000,
        available: false,
      })
    renderAccountPage()

    await user.click(await screen.findByRole('button', { name: '复制注册链接' }))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(await screen.findByRole('status')).toHaveTextContent('推荐计划已暂停')
    await act(async () => {
      resolveCopyRefresh({
        programEnabled: true,
        code: '8A4C19F2E7B603D5',
        rewardCount: 2,
        remainingRewards: 8,
        rewardTokens: 2_000_000,
        available: true,
      })
    })

    await waitFor(() => expect(referralMocks.fetch).toHaveBeenCalledTimes(3))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('shows a bounded error when the referral summary cannot be read', async () => {
    referralMocks.fetch.mockRejectedValueOnce(new Error('推荐计划信息读取失败，请稍后重试。'))
    renderAccountPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('推荐计划信息读取失败，请稍后重试。')
    expect(screen.getByRole('button', { name: '复制注册链接' })).toBeDisabled()
  })

  it('handles denied clipboard permission without an unhandled rejection', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('permission denied'))
    renderAccountPage()

    await user.click(await screen.findByRole('button', { name: '复制注册链接' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '复制失败，请检查浏览器剪贴板权限后重试。',
    )
    expect(screen.queryByText('邀请码注册链接已复制。')).not.toBeInTheDocument()
  })

  it('allows administrators to start synchronization from their account page', async () => {
    const user = userEvent.setup()
    renderAccountPage(adminAuthValue)

    const syncButton = await screen.findByRole('button', { name: '立即同步' })
    expect(syncButton).toBeEnabled()
    await user.click(syncButton)

    expect(accountMocks.invoke).toHaveBeenCalledWith('sync-stats', {
      body: { scope: 'member', member_id: 'member-1' },
    })
  })

  it('reports when a member platform enters the single retry queue', async () => {
    const user = userEvent.setup()
    accountMocks.invoke.mockResolvedValueOnce({
      data: { failed: 0, queued: 1 },
      error: null,
    })
    renderAccountPage(adminAuthValue)

    await user.click(await screen.findByRole('button', { name: '立即同步' }))

    expect(
      await screen.findByText('同步完成，1 个平台已进入唯一一次自动重试队列。'),
    ).toBeInTheDocument()
  })

  it('reports terminal platform failures returned by the member batch', async () => {
    const user = userEvent.setup()
    accountMocks.invoke.mockResolvedValueOnce({
      data: { failed: 2, queued: 0 },
      error: null,
    })
    renderAccountPage(adminAuthValue)

    await user.click(await screen.findByRole('button', { name: '立即同步' }))

    expect(await screen.findByText('同步完成，但有 2 个平台最终失败。')).toBeInTheDocument()
  })

  it('never includes XCPC ELO in user upsert or delete requests', async () => {
    const user = userEvent.setup()
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.type(screen.getByRole('textbox', { name: 'Codeforces 账号' }), 'NewHandle')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    await waitFor(() => expect(accountMocks.accountsUpsert).toHaveBeenCalled())
    const [upsertRows] = accountMocks.accountsUpsert.mock.calls[0] as [Array<{ platform: string }>]
    expect(upsertRows.map((row) => row.platform)).toEqual(['codeforces'])

    expect(accountMocks.accountsDeleteIn).not.toHaveBeenCalled()
  })

  it('rejects invalid platform identifiers before saving', async () => {
    const user = userEvent.setup()
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    const luoguInput = screen.getByRole('textbox', { name: '洛谷 账号' })
    await user.type(luoguInput, 'P1000')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    expect(await screen.findByText(/洛谷 UID 只能包含数字/)).toBeInTheDocument()
    expect(luoguInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('请先修正平台账号格式。')).toBeInTheDocument()
    expect(accountMocks.accountsUpsert).not.toHaveBeenCalled()
  })

  it('does not expose another member when a platform account is already bound', async () => {
    const user = userEvent.setup()
    accountMocks.accountsUpsert.mockResolvedValueOnce({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint platform_accounts_platform_external_unique',
      },
    })
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.type(screen.getByRole('textbox', { name: 'Codeforces 账号' }), 'TakenHandle')
    await user.click(screen.getByRole('button', { name: '保存资料' }))

    expect(
      await screen.findByText('该平台账号已被绑定，请检查填写内容或联系管理员。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/platform_accounts_platform_external_unique/)).not.toBeInTheDocument()
  })

  it('marks UID fields for numeric keyboard input', async () => {
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    expect(screen.getByRole('textbox', { name: '牛客 账号' })).toHaveAttribute(
      'inputmode',
      'numeric',
    )
    expect(screen.getByRole('textbox', { name: '洛谷 账号' })).toHaveAttribute(
      'inputmode',
      'numeric',
    )
  })

  it('allows a custom major and exposes matching suggestions', async () => {
    const user = userEvent.setup()
    renderAccountPage()

    const gradeInput = await screen.findByRole('combobox', { name: '年级' })
    expect(gradeInput).toHaveValue('24级')

    const majorInput = screen.getByRole('combobox', { name: '专业' })
    expect(majorInput).toHaveAttribute('list', 'major-suggestions')
    await user.clear(majorInput)
    await user.type(majorInput, '电子信息工程')
    expect(majorInput).toHaveValue('电子信息工程')

    await user.selectOptions(gradeInput, '23级')
    accountMocks.profileSingle.mockResolvedValueOnce({
      data: {
        full_name: '测试成员',
        qq: '12345678',
        major: '电子信息工程',
        grade: '23级',
      },
      error: null,
    })
    await user.click(screen.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(gradeInput).toHaveValue('23级'))
    expect(accountMocks.profileUpdate).toHaveBeenLastCalledWith({
      major: '电子信息工程',
      grade: '23级',
    })
    expect(loadAccountDraft('member-1')).toBeNull()
  })

  it('restores unsaved fields after the page is remounted', async () => {
    const user = userEvent.setup()
    const firstRender = renderAccountPage()

    const gradeSelect = await screen.findByRole('combobox', { name: '年级' })
    const majorInput = screen.getByRole('combobox', { name: '专业' })
    const codeforcesInput = screen.getByRole('textbox', { name: 'Codeforces 账号' })
    await user.selectOptions(gradeSelect, '23级')
    await user.clear(majorInput)
    await user.type(majorInput, '电子信息工程')
    await user.type(codeforcesInput, 'DraftHandle')

    firstRender.unmount()
    renderAccountPage()

    expect(await screen.findByText('已恢复未保存的修改。')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '年级' })).toHaveValue('23级')
    expect(screen.getByRole('combobox', { name: '专业' })).toHaveValue('电子信息工程')
    expect(screen.getByRole('textbox', { name: 'Codeforces 账号' })).toHaveValue('DraftHandle')
  })

  it('does not overwrite unsaved input when the same auth user object refreshes', async () => {
    const user = userEvent.setup()
    const view = renderAccountPage()

    const majorInput = await screen.findByRole('combobox', { name: '专业' })
    await user.clear(majorInput)
    await user.type(majorInput, '智能算法实验班')

    view.rerender(
      <AuthContext.Provider
        value={{ ...authValue, user: authValue.user ? { ...authValue.user } : null }}
      >
        <AccountPage />
      </AuthContext.Provider>,
    )

    expect(screen.getByRole('combobox', { name: '专业' })).toHaveValue('智能算法实验班')
  })

  it('verifies and updates a member password independently from profile saving', async () => {
    const user = userEvent.setup()
    vi.mocked(authValue.changePassword).mockResolvedValue(undefined)
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.type(screen.getByLabelText('当前密码'), 'old-password')
    const newPasswordInput = screen.getByLabelText('新密码')
    expect(newPasswordInput).toHaveAccessibleDescription('至少 8 位，不要与其他网站共用。')
    await user.type(newPasswordInput, 'new-password')
    await user.type(screen.getByLabelText('确认新密码'), 'new-password')
    await user.click(screen.getByRole('button', { name: '修改密码' }))

    expect(authValue.changePassword).toHaveBeenCalledWith('old-password', 'new-password')
    expect(await screen.findByRole('status')).toHaveTextContent('密码已更新。')
    expect(screen.getByLabelText('当前密码')).toHaveValue('')
    expect(accountMocks.profileUpdate).not.toHaveBeenCalled()
  })

  it('rejects mismatched new passwords before calling auth', async () => {
    const user = userEvent.setup()
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.type(screen.getByLabelText('当前密码'), 'old-password')
    await user.type(screen.getByLabelText('新密码'), 'new-password')
    await user.type(screen.getByLabelText('确认新密码'), 'different-password')
    await user.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('两次输入的新密码不一致。')
    expect(authValue.changePassword).not.toHaveBeenCalled()
  })

  it('clears every password field after a failed password change', async () => {
    const user = userEvent.setup()
    vi.mocked(authValue.changePassword).mockRejectedValue(new Error('当前密码错误'))
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.type(screen.getByLabelText('当前密码'), 'wrong-password')
    await user.type(screen.getByLabelText('新密码'), 'new-password')
    await user.type(screen.getByLabelText('确认新密码'), 'new-password')
    await user.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('当前密码错误')
    expect(screen.getByLabelText('当前密码')).toHaveValue('')
    expect(screen.getByLabelText('新密码')).toHaveValue('')
    expect(screen.getByLabelText('确认新密码')).toHaveValue('')
  })

  it('requires password and explicit confirmation before deleting a member account', async () => {
    const user = userEvent.setup()
    vi.mocked(authValue.deleteAccount).mockResolvedValue(undefined)
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    const deleteButton = screen.getByRole('button', { name: '永久注销账号' })
    expect(deleteButton).toBeDisabled()

    await user.type(screen.getByLabelText('账号密码'), 'current-password')
    await user.click(
      screen.getByRole('checkbox', {
        name: '我确认永久删除账号及全部训练数据，此操作无法撤销。',
      }),
    )
    expect(deleteButton).toBeEnabled()
    await user.click(deleteButton)

    expect(authValue.deleteAccount).toHaveBeenCalledTimes(1)
    expect(authValue.deleteAccount).toHaveBeenCalledWith('current-password')
  })

  it('clears the deletion password after a failed deletion attempt', async () => {
    const user = userEvent.setup()
    vi.mocked(authValue.deleteAccount).mockRejectedValue(new Error('账号注销暂不可用'))
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    const passwordInput = screen.getByLabelText('账号密码')
    await user.type(passwordInput, 'current-password')
    await user.click(
      screen.getByRole('checkbox', {
        name: '我确认永久删除账号及全部训练数据，此操作无法撤销。',
      }),
    )
    await user.click(screen.getByRole('button', { name: '永久注销账号' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('账号注销暂不可用')
    expect(passwordInput).toHaveValue('')
  })

  it('does not expose self-service deletion for administrator accounts', async () => {
    renderAccountPage(adminAuthValue)

    expect(await screen.findByText(/管理员账号不能自助注销/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '注销账号' })).not.toBeInTheDocument()
  })

  it('downloads the authenticated member own-data export', async () => {
    const user = userEvent.setup()
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.click(screen.getByRole('button', { name: '导出我的数据' }))

    await waitFor(() => expect(personalExportMocks.fetch).toHaveBeenCalledTimes(1))
    expect(personalExportMocks.download).toHaveBeenCalledWith({ schemaVersion: 1 })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '数据已导出为 usts-acm-land-personal-data_2026-07-19_05-06-07-890Z.json。',
    )
  })

  it('shows a bounded export error without starting a download', async () => {
    const user = userEvent.setup()
    personalExportMocks.fetch.mockRejectedValueOnce(new Error('个人数据导出失败，请稍后重试。'))
    renderAccountPage()

    await screen.findByDisplayValue('测试成员')
    await user.click(screen.getByRole('button', { name: '导出我的数据' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('个人数据导出失败，请稍后重试。')
    expect(personalExportMocks.download).not.toHaveBeenCalled()
  })
})
