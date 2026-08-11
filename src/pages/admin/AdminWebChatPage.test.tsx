import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const webChatConfigMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  updateConfig: vi.fn(),
  fetchPilotMembers: vi.fn(),
  fetchCacheSummary: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

vi.mock('../../lib/adminWebChatConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adminWebChatConfig')>()),
  fetchAdminWebChatConfig: webChatConfigMocks.fetchConfig,
  updateAdminWebChatConfig: webChatConfigMocks.updateConfig,
}))

vi.mock('../../lib/adminWebChatPilot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adminWebChatPilot')>()),
  fetchAdminWebChatPilotMembers: webChatConfigMocks.fetchPilotMembers,
  fetchAdminWebChatCacheSummary: webChatConfigMocks.fetchCacheSummary,
}))

import { AdminWebChatPage } from './AdminWebChatPage'

const configured = {
  baseUrl: 'https://relay.example.com/v1',
  model: 'gpt-5.6',
  apiKeyConfigured: true,
  requestsEnabled: false,
  globalDailyRequestLimit: 300,
  globalDailyTokenLimit: 1_000_000,
  dailyUsage: {
    usageDate: '2026-07-17',
    requestCount: 128,
    settledTokens: 420_000,
    reservedTokens: 80_000,
    resetAt: '2026-07-18T00:00:00+08:00',
    requestBudgetAlertedAt: null,
    tokenBudgetAlertedAt: null,
  },
  version: 7,
  updatedAt: '2026-07-17T08:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminWebChatPage />
    </MemoryRouter>,
  )
}

describe('AdminWebChatPage', () => {
  beforeEach(() => {
    webChatConfigMocks.fetchConfig.mockReset().mockResolvedValue(configured)
    webChatConfigMocks.updateConfig.mockReset()
    webChatConfigMocks.fetchPilotMembers.mockReset().mockResolvedValue([])
    webChatConfigMocks.fetchCacheSummary.mockReset().mockResolvedValue({
      observedRequests: 0,
      eligibleRequests: 0,
      cacheHitRequests: 0,
      eligibleInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('renders a read-only archived snapshot without configuration controls', async () => {
    renderPage()

    const archive = await screen.findByRole('region', { name: '遗留配置快照' })
    expect(screen.getByText('只读关闭', { selector: 'strong' })).toBeInTheDocument()
    expect(within(archive).getByText(configured.baseUrl)).toBeInTheDocument()
    expect(within(archive).getByText(configured.model)).toBeInTheDocument()
    expect(within(archive).getByText('已保存（不读取原值）')).toBeInTheDocument()
    expect(within(archive).getByText(/配置、密钥、预算与请求开关均不可修改/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
    expect(webChatConfigMocks.updateConfig).not.toHaveBeenCalled()
  })

  it('labels an old enabled database value as non-runnable legacy state', async () => {
    webChatConfigMocks.fetchConfig.mockResolvedValue({ ...configured, requestsEnabled: true })
    renderPage()

    expect(await screen.findByText('遗留值为允许，运行入口仍关闭')).toBeInTheDocument()
    expect(screen.getByText('只读关闭', { selector: 'strong' })).toBeInTheDocument()
  })

  it('shows shared request and Token usage, remaining budget, and Beijing reset time', async () => {
    renderPage()

    const usage = await screen.findByRole('region', { name: '今日全站用量' })
    const requests = within(usage).getByRole('group', { name: '今日请求预算' })
    const tokens = within(usage).getByRole('group', { name: '今日 Token 预算' })

    expect(within(requests).getByText('128 / 300')).toBeInTheDocument()
    expect(within(requests).getByText('172')).toBeInTheDocument()
    expect(within(tokens).getByText('500,000 / 1,000,000')).toBeInTheDocument()
    expect(within(tokens).getAllByText('500,000')).toHaveLength(2)
    expect(within(usage).getByText(/北京时间重置：/)).toHaveTextContent('07/18 00:00')
  })

  it('clamps remaining budget and progress when historical usage exceeds the limits', async () => {
    webChatConfigMocks.fetchConfig.mockResolvedValue({
      ...configured,
      dailyUsage: {
        ...configured.dailyUsage,
        requestCount: 350,
        settledTokens: 900_000,
        reservedTokens: 200_000,
      },
    })
    renderPage()

    const usage = await screen.findByRole('region', { name: '今日全站用量' })
    const requests = within(usage).getByRole('group', { name: '今日请求预算' })
    const tokens = within(usage).getByRole('group', { name: '今日 Token 预算' })
    expect(within(requests).getByText('0')).toBeInTheDocument()
    expect(within(tokens).getByText('0')).toBeInTheDocument()
    expect(within(requests).getByRole('progressbar')).toHaveAttribute('value', '300')
    expect(within(tokens).getByRole('progressbar')).toHaveAttribute('value', '1000000')
  })

  it('refreshes the read-only snapshot without exposing a write path', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('v7')

    await user.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(webChatConfigMocks.fetchConfig).toHaveBeenCalledTimes(2))
    expect(webChatConfigMocks.updateConfig).not.toHaveBeenCalled()
  })

  it('keeps member usage available when relay configuration fails independently', async () => {
    webChatConfigMocks.fetchConfig.mockRejectedValue(new Error('中转站配置服务暂时不可用'))
    webChatConfigMocks.fetchPilotMembers.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000101',
        name: '测试成员',
        grade: '24级',
        major: '计算机科学与技术',
        role: 'member',
        accountStatus: 'approved',
        accessEnabled: true,
        totalRequestLimit: 30,
        totalTokenLimit: 100_000,
        requestCount: 8,
        settledTokens: 18_420,
        reservedTokens: 4_000,
        remainingRequests: 22,
        remainingTokens: 77_580,
        activeRequestCount: 1,
        lastRequestAt: '2026-07-18T08:30:00+08:00',
        version: 2,
        updatedAt: '2026-07-17T20:00:00+08:00',
      },
    ])
    renderPage()

    expect(await screen.findByText('WebChat 配置暂不可用')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'AI 助手账号与用量' })).toBeInTheDocument()
    expect(screen.getByText('8 / 30')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
  })
})
