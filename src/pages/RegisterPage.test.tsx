import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'

const referralMocks = vi.hoisted(() => ({
  check: vi.fn(),
}))

const captchaMocks = vi.hoisted(() => ({
  config: vi.fn(),
}))

vi.mock('../lib/referrals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/referrals')>()
  return {
    ...actual,
    checkReferralCodeAvailability: referralMocks.check,
  }
})

vi.mock('../lib/registrationCaptcha', () => ({
  getRegistrationCaptchaConfig: captchaMocks.config,
}))

vi.mock('../components/RegistrationTurnstile', () => ({
  RegistrationTurnstile: ({
    resetKey,
    onTokenChange,
  }: {
    resetKey: number
    onTokenChange: (token: string) => void
  }) => {
    useEffect(() => onTokenChange(''), [onTokenChange, resetKey])
    return (
      <button type="button" onClick={() => onTokenChange('verified-turnstile-token')}>
        完成安全验证
      </button>
    )
  },
}))

import { RegisterPage } from './RegisterPage'

function authValue(signUp: AuthContextValue['signUp']): AuthContextValue {
  return {
    status: 'anonymous',
    user: null,
    isDemo: false,
    isPasswordRecovery: false,
    signUp,
    signIn: vi.fn(),
    changePassword: vi.fn(),
    completePasswordRecovery: vi.fn(),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
  }
}

function renderRegister(signUp: AuthContextValue['signUp'], initialEntry = '/register') {
  return render(
    <AuthContext.Provider value={authValue(signUp)}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/account" element={<h1>我的资料</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    referralMocks.check.mockReset().mockResolvedValue({
      programEnabled: true,
      available: true,
    })
    captchaMocks.config.mockReset().mockReturnValue({
      enabled: false,
      siteKey: '',
      configurationError: null,
    })
  })

  it('requires and submits a fresh Turnstile token when registration protection is enabled', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    captchaMocks.config.mockReturnValue({
      enabled: true,
      siteKey: '1x00000000000000000000AA',
      configurationError: null,
    })
    renderRegister(signUp)

    const submit = screen.getByRole('button', { name: '注册' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '完成安全验证' }))
    expect(submit).toBeEnabled()

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(submit)

    expect(signUp).toHaveBeenCalledWith(
      '测试成员',
      'new@example.com',
      'password123',
      '',
      'verified-turnstile-token',
    )
    await waitFor(() => expect(submit).toBeDisabled())
  })

  it('fails closed when Turnstile is enabled without a site key', async () => {
    captchaMocks.config.mockReturnValue({
      enabled: true,
      siteKey: '',
      configurationError: '注册安全验证尚未配置完成，请联系管理员。',
    })
    renderRegister(vi.fn())

    expect(screen.getByRole('alert')).toHaveTextContent('注册安全验证尚未配置完成')
    expect(screen.getByRole('button', { name: '注册' })).toBeDisabled()
    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(1))
  })

  it('enters the account page immediately when signup returns a session', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(true)
    renderRegister(signUp)

    expect(screen.getByRole('heading', { name: 'USTS ACM Land' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '姓名' }), '  测试成员  ')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    const passwordInput = screen.getByLabelText('密码')
    expect(passwordInput).toHaveAccessibleDescription('至少 8 位，不要与其他网站共用。')
    await user.type(passwordInput, 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(signUp).toHaveBeenCalledWith('测试成员', 'new@example.com', 'password123', '')
    expect(await screen.findByRole('heading', { name: '我的资料' })).toBeInTheDocument()
  })

  it('explains a legacy confirmation requirement when no session is returned', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    renderRegister(signUp)

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '账号已创建，但当前认证配置仍要求邮箱验证；验证后即可登录。',
    )
  })

  it('rejects a whitespace-only name before calling signup', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn()
    renderRegister(signUp)

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '   ')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入姓名。')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('prefills and submits an invitation from a shared registration link', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    renderRegister(signUp, '/register?invite=8a4c19f2e7b603d5')

    expect(await screen.findByRole('textbox', { name: '邀请码（选填）' })).toHaveValue(
      '8A4C19F2E7B603D5',
    )
    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(signUp).toHaveBeenCalledWith(
      '测试成员',
      'new@example.com',
      'password123',
      '8A4C19F2E7B603D5',
    )
  })

  it('rejects a malformed invitation before calling signup', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn()
    renderRegister(signUp, '/register?invite=not-a-code')

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('邀请码应为 16 位字母或数字。')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('hides and ignores a shared invitation while the program is paused', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    referralMocks.check.mockResolvedValue({ programEnabled: false, available: false })
    renderRegister(signUp, '/register?invite=8a4c19f2e7b603d5')

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '邀请码（选填）' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(signUp).toHaveBeenCalledWith('测试成员', 'new@example.com', 'password123', '')
  })

  it('keeps no-invitation registration available when status lookup fails', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    referralMocks.check.mockRejectedValue(new Error('offline'))
    renderRegister(signUp)

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '邀请码（选填）' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(signUp).toHaveBeenCalledWith('测试成员', 'new@example.com', 'password123', '')
  })

  it('ignores a shared invitation when status lookup fails', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    referralMocks.check.mockRejectedValue(new Error('offline'))
    renderRegister(signUp, '/register?invite=8a4c19f2e7b603d5')

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '邀请码（选填）' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(signUp).toHaveBeenCalledWith('测试成员', 'new@example.com', 'password123', '')
  })

  it('refreshes the global state when the registration page regains focus', async () => {
    referralMocks.check
      .mockResolvedValueOnce({ programEnabled: true, available: false })
      .mockResolvedValueOnce({ programEnabled: false, available: false })
    renderRegister(vi.fn(), '/register?invite=8a4c19f2e7b603d5')

    expect(await screen.findByRole('textbox', { name: '邀请码（选填）' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('focus')))

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '邀请码（选填）' })).not.toBeInTheDocument()
  })
})
