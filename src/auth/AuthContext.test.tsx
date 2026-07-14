import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from './AuthContext'
import { useAuth } from './authContextValue'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  profileMaybeSingle: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  demoAuthEnabled: false,
  supabase: {
    auth: authMocks,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: authMocks.profileMaybeSingle }),
      }),
    }),
    functions: { invoke: authMocks.invoke },
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
    authMocks.profileMaybeSingle.mockReset()
    authMocks.invoke.mockReset()
    authMocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
    authMocks.profileMaybeSingle.mockResolvedValue({
      data: { role: 'member', review_status: 'approved' },
      error: null,
    })
    authMocks.invoke.mockResolvedValue({ data: { status: 'success' }, error: null })
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
    expect(authMocks.invoke).not.toHaveBeenCalled()
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

  it('starts an XCPC ELO synchronization when registration creates a session', async () => {
    const user = userEvent.setup()
    const registeredUser = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com' }
    authMocks.signUp.mockResolvedValue({
      data: { session: { access_token: 'test-token' }, user: registeredUser },
      error: null,
    })

    render(
      <AuthProvider>
        <SignUpProbe />
      </AuthProvider>,
    )
    await user.click(screen.getByRole('button', { name: '注册' }))

    await waitFor(() =>
      expect(authMocks.invoke).toHaveBeenCalledWith('sync-member', {
        body: {
          memberId: registeredUser.id,
          platforms: ['xcpc_elo'],
          triggerType: 'registration',
        },
      }),
    )
  })

  it('retries once when the XCPC ELO registration synchronization cannot start', async () => {
    const user = userEvent.setup()
    const registeredUser = { id: '22222222-2222-4222-8222-222222222222', email: 'test@example.com' }
    authMocks.signUp.mockResolvedValue({
      data: { session: { access_token: 'test-token' }, user: registeredUser },
      error: null,
    })
    authMocks.invoke
      .mockResolvedValueOnce({ data: null, error: new Error('temporary failure') })
      .mockResolvedValueOnce({ data: { status: 'success' }, error: null })

    render(
      <AuthProvider>
        <SignUpProbe />
      </AuthProvider>,
    )
    await user.click(screen.getByRole('button', { name: '注册' }))

    await waitFor(() => expect(authMocks.invoke).toHaveBeenCalledTimes(2))
  })
})
