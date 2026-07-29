import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'

const { resetPasswordForEmail, captchaConfig } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  captchaConfig: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  demoAuthEnabled: false,
  supabase: {
    auth: { resetPasswordForEmail },
  },
}))

vi.mock('../lib/registrationCaptcha', () => ({
  getRegistrationCaptchaConfig: captchaConfig,
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
      <button type="button" onClick={() => onTokenChange('verified-recovery-token')}>
        完成找回密码安全验证
      </button>
    )
  },
}))

import { ForgotPasswordPage } from './ForgotPasswordPage'

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null })
    captchaConfig.mockReset().mockReturnValue({
      enabled: false,
      siteKey: '',
      configurationError: null,
    })
  })

  it('sends a recovery email back to the reset-password route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'member@example.com')
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }))

    expect(resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
      redirectTo: 'http://localhost:3000/reset-password',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '如果该邮箱已注册，重置邮件将很快送达。',
    )
  })

  it('requires and submits a Turnstile token when authentication protection is enabled', async () => {
    const user = userEvent.setup()
    captchaConfig.mockReturnValue({
      enabled: true,
      siteKey: '1x00000000000000000000AA',
      configurationError: null,
    })
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    )

    const submit = screen.getByRole('button', { name: '发送重置邮件' })
    expect(submit).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'member@example.com')
    await user.click(screen.getByRole('button', { name: '完成找回密码安全验证' }))
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
      redirectTo: 'http://localhost:3000/reset-password',
      captchaToken: 'verified-recovery-token',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '如果该邮箱已注册，重置邮件将很快送达。',
    )
  })
})
