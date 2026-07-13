import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import { loadAccountDraft } from '../lib/accountDraft'

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

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: accountMocks.from,
    functions: { invoke: accountMocks.invoke },
  },
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
  signIn: vi.fn(),
  signOut: vi.fn(),
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
    accountMocks.profileSingle.mockReset()
    accountMocks.profileUpdate.mockReset()
    accountMocks.profileUpdateEq.mockReset()

    accountMocks.profileSingle.mockResolvedValue({
      data: {
        full_name: '测试成员',
        qq: '12345678',
        major: '计算机科学与技术',
        grade: '24级',
        review_status: 'approved',
      },
      error: null,
    })
    accountMocks.accountsSelectEq.mockResolvedValue({ data: [xcpcAccount], error: null })
    accountMocks.profileUpdateEq.mockResolvedValue({ error: null })
    accountMocks.profileUpdate.mockImplementation(() => ({ eq: accountMocks.profileUpdateEq }))
    accountMocks.accountsUpsert.mockResolvedValue({ error: null })
    accountMocks.accountsDeleteIn.mockResolvedValue({ error: null })
    accountMocks.invoke.mockResolvedValue({ error: null })

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

  it('shows a read-only name match and allows a pending automatic record to sync', async () => {
    const user = userEvent.setup()
    renderAccountPage()

    expect(await screen.findByText('按「姓名 + 苏州科技大学」自动匹配')).toBeInTheDocument()
    expect(screen.queryByLabelText('XCPC ELO 账号')).not.toBeInTheDocument()

    const syncButton = screen.getByRole('button', { name: '立即同步' })
    expect(syncButton).toBeEnabled()
    await user.click(syncButton)

    expect(accountMocks.invoke).toHaveBeenCalledWith('sync-member', {
      body: { memberId: 'member-1', triggerType: 'manual' },
    })
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
        review_status: 'pending',
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
})
