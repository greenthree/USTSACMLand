import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import { ResetPasswordPage } from './ResetPasswordPage'

function authValue(
  completePasswordRecovery: AuthContextValue['completePasswordRecovery'],
  isPasswordRecovery = true,
): AuthContextValue {
  return {
    status: 'authenticated',
    user: {
      id: 'member-1',
      email: 'member@example.com',
      role: 'member',
      reviewStatus: 'approved',
    },
    isDemo: false,
    isPasswordRecovery,
    signUp: vi.fn(),
    signIn: vi.fn(),
    changePassword: vi.fn(),
    completePasswordRecovery,
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
  }
}

function renderPage(value: AuthContextValue) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/reset-password']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<h1>登录页面</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('ResetPasswordPage', () => {
  it('updates the password and returns to login after a valid recovery session', async () => {
    const user = userEvent.setup()
    const completePasswordRecovery = vi.fn().mockResolvedValue(undefined)
    renderPage(authValue(completePasswordRecovery))

    const newPassword = screen.getByLabelText('新密码')
    expect(newPassword).toHaveAccessibleDescription('至少 8 位，不要与其他网站共用。')
    await user.type(newPassword, 'recovered-password')
    await user.type(screen.getByLabelText('确认新密码'), 'recovered-password')
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    expect(completePasswordRecovery).toHaveBeenCalledWith('recovered-password')
    expect(await screen.findByRole('heading', { name: '登录页面' })).toBeInTheDocument()
  })

  it('rejects mismatched passwords before changing Auth', async () => {
    const user = userEvent.setup()
    const completePasswordRecovery = vi.fn()
    renderPage(authValue(completePasswordRecovery))

    await user.type(screen.getByLabelText('新密码'), 'recovered-password')
    await user.type(screen.getByLabelText('确认新密码'), 'different-password')
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('两次输入的新密码不一致。')
    expect(completePasswordRecovery).not.toHaveBeenCalled()
  })

  it('does not expose password fields without a recovery session', () => {
    renderPage(authValue(vi.fn(), false))

    expect(screen.getByText('密码重置链接无效或已过期，请重新申请。')).toBeInTheDocument()
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新发送重置邮件' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})
