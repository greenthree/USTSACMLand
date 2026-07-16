import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from './AuthContext'
import { useAuth } from './authContextValue'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
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

function DeleteAccountProbe() {
  const { user, deleteAccount } = useAuth()
  return (
    <button type="button" disabled={!user} onClick={() => void deleteAccount('current-password')}>
      注销测试账号
    </button>
  )
}

function ChangePasswordProbe() {
  const { user, changePassword } = useAuth()
  return (
    <button
      type="button"
      disabled={!user}
      onClick={() => void changePassword('current-password', 'new-password')}
    >
      修改测试密码
    </button>
  )
}

function PasswordRecoveryProbe() {
  const { completePasswordRecovery, isPasswordRecovery } = useAuth()
  return (
    <button
      type="button"
      disabled={!isPasswordRecovery}
      onClick={() => void completePasswordRecovery('recovered-password')}
    >
      完成密码恢复
    </button>
  )
}

describe('AuthProvider registration metadata', () => {
  beforeEach(() => {
    sessionStorage.clear()
    authMocks.getSession.mockResolvedValue({ data: { session: null } })
    authMocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    authMocks.signUp.mockReset()
    authMocks.signOut.mockReset().mockResolvedValue({ error: null })
    authMocks.updateUser.mockReset().mockResolvedValue({ error: null })
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

  it('invokes password-verified account deletion and clears the local session', async () => {
    const user = userEvent.setup()
    const existingUser = {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'member@example.com',
    }
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: existingUser } },
    })
    authMocks.invoke.mockResolvedValueOnce({ data: { deleted: true }, error: null })

    render(
      <AuthProvider>
        <DeleteAccountProbe />
      </AuthProvider>,
    )

    const deleteButton = screen.getByRole('button', { name: '注销测试账号' })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    await user.click(deleteButton)

    await waitFor(() =>
      expect(authMocks.invoke).toHaveBeenCalledWith('delete-account', {
        body: { currentPassword: 'current-password' },
      }),
    )
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('uses the password-verified Edge Function instead of updating Auth directly', async () => {
    const user = userEvent.setup()
    const existingUser = {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'member@example.com',
    }
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: existingUser } },
    })
    authMocks.invoke.mockResolvedValueOnce({
      data: { updated: true, sessionsRevoked: true },
      error: null,
    })

    render(
      <AuthProvider>
        <ChangePasswordProbe />
      </AuthProvider>,
    )

    const changeButton = screen.getByRole('button', { name: '修改测试密码' })
    await waitFor(() => expect(changeButton).toBeEnabled())
    await user.click(changeButton)

    await waitFor(() =>
      expect(authMocks.invoke).toHaveBeenCalledWith('change-password', {
        body: {
          currentPassword: 'current-password',
          newPassword: 'new-password',
        },
      }),
    )
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(sessionStorage.getItem('usts-acm-land-password-change-notice:v1')).toBe('success')
  })

  it('forces a local sign-out when global password-session revocation is unconfirmed', async () => {
    const user = userEvent.setup()
    const existingUser = {
      id: '66666666-6666-4666-8666-666666666666',
      email: 'member@example.com',
    }
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: existingUser } },
    })
    authMocks.invoke.mockResolvedValueOnce({
      data: { updated: true, sessionsRevoked: false },
      error: null,
    })

    render(
      <AuthProvider>
        <ChangePasswordProbe />
      </AuthProvider>,
    )

    const changeButton = screen.getByRole('button', { name: '修改测试密码' })
    await waitFor(() => expect(changeButton).toBeEnabled())
    await user.click(changeButton)

    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledWith({ scope: 'local' }))
    expect(sessionStorage.getItem('usts-acm-land-password-change-notice:v1')).toBe(
      'revocation-warning',
    )
  })

  it('completes a marked recovery session and revokes existing sessions', async () => {
    const user = userEvent.setup()
    const existingUser = {
      id: '55555555-5555-4555-8555-555555555555',
      email: 'member@example.com',
    }
    sessionStorage.setItem('usts-acm-land-password-recovery:v1', 'active')
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: existingUser } },
    })

    render(
      <AuthProvider>
        <PasswordRecoveryProbe />
      </AuthProvider>,
    )

    const recoveryButton = screen.getByRole('button', { name: '完成密码恢复' })
    await waitFor(() => expect(recoveryButton).toBeEnabled())
    await user.click(recoveryButton)

    await waitFor(() =>
      expect(authMocks.updateUser).toHaveBeenCalledWith({ password: 'recovered-password' }),
    )
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(sessionStorage.getItem('usts-acm-land-password-recovery:v1')).toBeNull()
  })
})
