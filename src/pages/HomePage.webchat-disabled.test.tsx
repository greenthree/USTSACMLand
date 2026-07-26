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
  it('keeps the assistant card as a plan instead of a link', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthContext.Provider value={anonymousAuth}>
          <MembersDataContext.Provider value={defaultMembersDataState}>
            <HomePage />
          </MembersDataContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText('规划中')).toBeInTheDocument()
    expect(screen.getByText(/计划接入大模型/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /AI 学习助手/ })).not.toBeInTheDocument()
  })
})
