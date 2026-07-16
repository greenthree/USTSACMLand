import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { storePasswordChangeNotice } from '../auth/passwordChangeNotice'
import { LoginPage } from './LoginPage'

vi.mock('../auth/authContextValue', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    status: 'anonymous',
    user: null,
    isDemo: false,
  }),
}))

vi.mock('../lib/supabase', () => ({
  hasSupabaseConfig: true,
}))

describe('LoginPage password-change feedback', () => {
  beforeEach(() => sessionStorage.clear())

  it('confirms that a successful password change signed out every device', () => {
    storePasswordChangeNotice('success')
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '密码已更新，所有设备均已退出，请使用新密码登录。',
    )
  })

  it('warns when other-device session revocation was not confirmed', () => {
    storePasswordChangeNotice('revocation-warning')
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      '密码已更新，本设备已退出，但无法确认其他设备会话均已撤销。',
    )
  })
})
