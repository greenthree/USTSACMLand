import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from './AuthContext'
import { useAuth } from './authContextValue'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  demoAuthEnabled: false,
  supabase: {
    auth: authMocks,
  },
}))

function SignUpProbe() {
  const { signUp } = useAuth()
  return (
    <button
      type="button"
      onClick={() => void signUp('测试成员', 'test@example.com', 'password123')}
    >
      注册
    </button>
  )
}

function InvalidSignUpProbe() {
  const { signUp } = useAuth()
  return (
    <button
      type="button"
      onClick={() => void signUp('  ', 'test@example.com', 'password123').catch(() => undefined)}
    >
      注册
    </button>
  )
}

describe('AuthProvider registration metadata', () => {
  beforeEach(() => {
    authMocks.getSession.mockResolvedValue({ data: { session: null } })
    authMocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    authMocks.signUp.mockReset()
    authMocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
  })

  it('passes the required name to Supabase user metadata', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <SignUpProbe />
      </AuthProvider>,
    )

    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(authMocks.signUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
      options: { data: { full_name: '测试成员' } },
    })
  })

  it('rejects a missing name before contacting Supabase', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <InvalidSignUpProbe />
      </AuthProvider>,
    )
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(authMocks.signUp).not.toHaveBeenCalled()
  })
})
