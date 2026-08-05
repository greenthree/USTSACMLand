import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import { defaultMembersDataState, MembersDataContext } from '../data/membersDataContext'
import { HomePage } from './HomePage'

vi.mock('../features/chat/chatAvailability', () => ({
  webChatUiEnabled: false,
}))

const anonymousAuth: AuthContextValue = {
  status: 'anonymous',
  user: null,
  isDemo: false,
  isPasswordRecovery: false,
  signUp: vi.fn(async () => true),
  signIn: vi.fn(async () => {}),
  changePassword: vi.fn(async () => {}),
  completePasswordRecovery: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}

describe('HomePage with the web chat UI disabled', () => {
  it('removes the retired assistant from the public resource list', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthContext.Provider value={anonymousAuth}>
          <MembersDataContext.Provider value={defaultMembersDataState}>
            <HomePage />
          </MembersDataContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText('2 MODULES')).toBeInTheDocument()
    expect(screen.queryByText('3 MODULES')).not.toBeInTheDocument()
    expect(screen.queryByText('AI 学习助手')).not.toBeInTheDocument()
    expect(screen.queryByText('规划中')).not.toBeInTheDocument()
    expect(screen.queryByText(/计划接入大模型/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /AI 学习助手/ })).not.toBeInTheDocument()
  })
})
