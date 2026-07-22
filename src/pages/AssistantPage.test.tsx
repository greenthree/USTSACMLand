import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const assistantMocks = vi.hoisted(() => ({ fetchUsage: vi.fn() }))

vi.mock('../lib/webChatMemberAccess', () => ({
  fetchOwnWebChatUsage: assistantMocks.fetchUsage,
}))
vi.mock('../features/chat/ChatRuntime', () => ({
  ChatRuntime: ({ onUsageChanged }: { onUsageChanged?: () => void }) => (
    <button type="button" onClick={onUsageChanged}>
      模拟 AI 对话工作台
    </button>
  ),
}))

import { AssistantPage } from './AssistantPage'

const usage = {
  enabled: true,
  model: 'gpt-5.6-sol',
  requests: { limit: 30, used: 8, remaining: 22 },
  tokens: { limit: 100_000, settled: 18_400, reserved: 0, remaining: 81_600 },
}

function renderAssistantPage() {
  return render(
    <MemoryRouter>
      <AssistantPage />
    </MemoryRouter>,
  )
}

describe('AssistantPage member quota gate', () => {
  beforeEach(() => assistantMocks.fetchUsage.mockReset())

  it('shows the authorized member cumulative request and Token allowance', async () => {
    assistantMocks.fetchUsage.mockResolvedValue(usage)
    renderAssistantPage()

    expect(await screen.findByText('模拟 AI 对话工作台')).toBeInTheDocument()
    expect(screen.queryByText('把卡住你的地方，')).not.toBeInTheDocument()
    const quota = screen.getByRole('region', { name: 'AI 助手累计额度' })
    expect(quota).toHaveTextContent('剩余请求')
    expect(quota).toHaveTextContent('22')
    expect(quota).toHaveTextContent('81,600')
    expect(quota).toHaveTextContent('18,400')
    expect(quota).toHaveTextContent('当前模型 gpt-5.6-sol')
    expect(quota).toHaveTextContent('额度由管理员设定，不会每日重置')
    expect(quota).toHaveTextContent('累计已用')
  })

  it('does not mount the chat runtime for a member without access', async () => {
    assistantMocks.fetchUsage.mockResolvedValue({ ...usage, enabled: false })
    renderAssistantPage()

    expect(await screen.findByText(/尚未开通 AI 学习助手/)).toBeInTheDocument()
    expect(screen.queryByText('模拟 AI 对话工作台')).not.toBeInTheDocument()
  })

  it('can retry an isolated quota read failure', async () => {
    const user = userEvent.setup()
    assistantMocks.fetchUsage
      .mockRejectedValueOnce(new Error('AI 助手额度读取失败'))
      .mockResolvedValueOnce(usage)
    renderAssistantPage()

    expect(await screen.findByText('AI 助手额度读取失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('模拟 AI 对话工作台')).toBeInTheDocument()
    expect(assistantMocks.fetchUsage).toHaveBeenCalledTimes(2)
  })

  it('refreshes usage after a chat run completes', async () => {
    const user = userEvent.setup()
    assistantMocks.fetchUsage.mockResolvedValueOnce(usage).mockResolvedValueOnce({
      ...usage,
      requests: { limit: 30, used: 9, remaining: 21 },
    })
    renderAssistantPage()

    await user.click(await screen.findByRole('button', { name: '模拟 AI 对话工作台' }))
    expect(await screen.findByText('21')).toBeInTheDocument()
    expect(assistantMocks.fetchUsage).toHaveBeenCalledTimes(2)
  })
})
