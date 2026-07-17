import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatTransport, UIMessage } from 'ai'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../../auth/authContextValue'
import { WebChatApiError } from './chatApi'
import { MockChatTransport } from './spike/MockChatTransport'
import { ChatRuntime } from './ChatRuntime'

const signOut = vi.fn<() => Promise<void>>()

const authValue: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'member@example.edu.cn',
    role: 'member',
    reviewStatus: 'approved',
  },
  isDemo: false,
  isPasswordRecovery: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  changePassword: vi.fn(),
  completePasswordRecovery: vi.fn(),
  deleteAccount: vi.fn(),
  signOut,
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{`${location.pathname}${location.search}`}</output>
}

function renderChat(transport: ChatTransport<UIMessage>) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/assistant']}>
        <ChatRuntime transport={transport} />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('AI learning assistant workspace', () => {
  beforeEach(() => {
    signOut.mockReset().mockResolvedValue()
  })

  it('fills a suggestion, streams a reply, copies or retries it, and clears the conversation', async () => {
    const user = userEvent.setup()
    renderChat(new MockChatTransport({ chunkDelayMs: 0 }))

    const input = screen.getByRole('textbox', { name: '向 AI 学习助手提问' })
    await user.click(screen.getByRole('button', { name: '给我一条学习二分答案的练习路线' }))
    expect(input).toHaveValue('给我一条学习二分答案的练习路线')

    await user.click(screen.getByRole('button', { name: '发送问题' }))
    expect(await screen.findByText(/我们先拆解这个问题/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制回复' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清空对话' }))
    expect(
      screen.getByRole('heading', { name: '把题意、思路或代码放到工作台上。' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/我们先拆解这个问题/)).not.toBeInTheDocument()
  })

  it('stops an active stream and keeps clear disabled while generation is running', async () => {
    const user = userEvent.setup()
    renderChat(new MockChatTransport({ chunkDelayMs: 25 }))

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '输出长讲解')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByRole('button', { name: '停止生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空对话' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '停止生成' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送问题' })).toBeInTheDocument()
    })
  })

  it('keeps a failed request visible after the run finishes', async () => {
    const user = userEvent.setup()
    const failedTransport: ChatTransport<UIMessage> = {
      async sendMessages() {
        throw new WebChatApiError('登录状态已失效，请重新登录。', 401, 'unauthorized')
      },
      async reconnectToStream() {
        return null
      },
    }
    renderChat(failedTransport)

    await user.type(screen.getByRole('textbox', { name: '向 AI 学习助手提问' }), '测试错误')
    await user.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('登录状态已失效，请重新登录。')
    await user.click(screen.getByRole('button', { name: '重新登录' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('current route')).toHaveTextContent('/login?returnTo=%2Fassistant')
  })
})
