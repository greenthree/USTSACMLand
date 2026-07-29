import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { storePasswordChangeNotice } from '../auth/passwordChangeNotice'

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

const captchaMocks = vi.hoisted(() => ({
  config: vi.fn(),
}))

vi.mock('../auth/authContextValue', () => ({
  useAuth: () => ({
    signIn: authMocks.signIn,
    status: 'anonymous',
    user: null,
    isDemo: false,
  }),
}))

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
      <button type="button" onClick={() => onTokenChange('verified-login-token')}>
        完成登录安全验证
      </button>
    )
  },
}))

vi.mock('../lib/supabase', () => ({
  hasSupabaseConfig: true,
}))

import { LoginPage } from './LoginPage'

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account" element={<h1>我的资料</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    authMocks.signIn.mockReset().mockResolvedValue(undefined)
    captchaMocks.config.mockReset().mockReturnValue({
      enabled: false,
      siteKey: '',
      configurationError: null,
    })
  })

  it('requires and submits a fresh Turnstile token when authentication protection is enabled', async () => {
    const user = userEvent.setup()
    captchaMocks.config.mockReturnValue({
      enabled: true,
      siteKey: '1x00000000000000000000AA',
      configurationError: null,
    })
    renderLogin()

    const submit = screen.getByRole('button', { name: '登录' })
    expect(submit).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'member@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '完成登录安全验证' }))
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(authMocks.signIn).toHaveBeenCalledWith(
      'member@example.com',
      'password123',
      'verified-login-token',
    )
    expect(await screen.findByRole('heading', { name: '我的资料' })).toBeInTheDocument()
  })

  it('invalidates the one-time Turnstile token after a failed sign-in', async () => {
    const user = userEvent.setup()
    authMocks.signIn.mockRejectedValue(new Error('邮箱或密码错误。'))
    captchaMocks.config.mockReturnValue({
      enabled: true,
      siteKey: '1x00000000000000000000AA',
      configurationError: null,
    })
    renderLogin()

    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'member@example.com')
    await user.type(screen.getByLabelText('密码'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: '完成登录安全验证' }))
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误。')
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeDisabled())
  })

  it('fails closed when authentication Turnstile is enabled without a site key', () => {
    captchaMocks.config.mockReturnValue({
      enabled: true,
      siteKey: '',
      configurationError: '账号安全验证尚未配置完成，请联系管理员。',
    })
    renderLogin()

    expect(screen.getByRole('alert')).toHaveTextContent('安全验证尚未配置完成')
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
  })

  it('confirms that a successful password change signed out every device', () => {
    storePasswordChangeNotice('success')
    renderLogin()

    expect(screen.getByRole('status')).toHaveTextContent(
      '密码已更新，所有设备均已退出，请使用新密码登录。',
    )
  })

  it('warns when other-device session revocation was not confirmed', () => {
    storePasswordChangeNotice('revocation-warning')
    renderLogin()

    expect(screen.getByRole('alert')).toHaveTextContent(
      '密码已更新，本设备已退出，但无法确认其他设备会话均已撤销。',
    )
  })
})
