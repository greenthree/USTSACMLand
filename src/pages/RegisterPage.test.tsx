import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import { RegisterPage } from './RegisterPage'

function authValue(signUp: AuthContextValue['signUp']): AuthContextValue {
  return {
    status: 'anonymous',
    user: null,
    isDemo: false,
    signUp,
    signIn: vi.fn(),
    changePassword: vi.fn(),
    signOut: vi.fn(),
  }
}

function renderRegister(signUp: AuthContextValue['signUp']) {
  return render(
    <AuthContext.Provider value={authValue(signUp)}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/account" element={<h1>我的资料</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('RegisterPage', () => {
  it('enters the account page immediately when signup returns a session', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(true)
    renderRegister(signUp)

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '  测试成员  ')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText(/^密码/), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(signUp).toHaveBeenCalledWith('测试成员', 'new@example.com', 'password123')
    expect(await screen.findByRole('heading', { name: '我的资料' })).toBeInTheDocument()
  })

  it('explains a legacy confirmation requirement when no session is returned', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn().mockResolvedValue(false)
    renderRegister(signUp)

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '测试成员')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText(/^密码/), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(
      await screen.findByText('账号已创建，但当前认证配置仍要求邮箱验证；验证后即可登录。'),
    ).toBeInTheDocument()
  })

  it('rejects a whitespace-only name before calling signup', async () => {
    const user = userEvent.setup()
    const signUp = vi.fn()
    renderRegister(signUp)

    await user.type(screen.getByRole('textbox', { name: '姓名' }), '   ')
    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'new@example.com')
    await user.type(screen.getByLabelText(/^密码/), 'password123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByText('请输入姓名。')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })
})
