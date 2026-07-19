import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const webChatConfigMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  updateConfig: vi.fn(),
  fetchPilotMembers: vi.fn(),
  fetchCacheSummary: vi.fn(),
  fetchObservation: vi.fn(),
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
  fetchAdminWebChatPilotObservation: webChatConfigMocks.fetchObservation,
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
    localStorage.clear()
    sessionStorage.clear()
    webChatConfigMocks.fetchConfig.mockReset().mockResolvedValue(configured)
    webChatConfigMocks.updateConfig.mockReset().mockResolvedValue({
      ...configured,
      version: 8,
      updatedAt: '2026-07-17T09:00:00Z',
    })
    webChatConfigMocks.fetchPilotMembers.mockReset().mockResolvedValue([])
    webChatConfigMocks.fetchCacheSummary.mockReset().mockResolvedValue({
      observedRequests: 0,
      eligibleRequests: 0,
      cacheHitRequests: 0,
      eligibleInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    })
    webChatConfigMocks.fetchObservation.mockReset().mockResolvedValue({
      checkedAt: '2026-07-19T09:30:00Z',
      cohortStartedAt: null,
      observationHours: 0,
      enabledMembers: 0,
      activeMembers: 0,
      observedRequests: 0,
      successfulRequests: 0,
      incompleteRequests: 0,
      failedRequests: 0,
      unknownUsageRequests: 0,
      activeGenerationCount: 0,
      cacheEligibleRequests: 0,
      cacheHitRequests: 0,
      lastRequestAt: null,
      status: 'cohort_size_invalid',
    })
  })

  it('shows only redacted secret state, version, and update time', async () => {
    renderPage()

    expect(await screen.findByText('已配置')).toBeInTheDocument()
    expect(screen.getByText('v7')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /中转站 Base URL/ })).toHaveValue(configured.baseUrl)
    expect(screen.getByLabelText(/替换 API Key/)).toHaveValue('')
    expect(screen.getByText(/旧 Key 永不回显/)).toBeInTheDocument()
  })

  it('shows shared request and Token usage, remaining budget, and Beijing reset time', async () => {
    renderPage()

    const usage = await screen.findByRole('region', { name: '今日全站用量' })
    const requests = within(usage).getByRole('group', { name: '今日请求预算' })
    const tokens = within(usage).getByRole('group', { name: '今日 Token 预算' })

    expect(within(requests).getByText('128 / 300')).toBeInTheDocument()
    expect(within(requests).getByText('172')).toBeInTheDocument()
    expect(within(requests).getByRole('progressbar', { name: '今日全站请求用量' })).toHaveAttribute(
      'value',
      '128',
    )

    expect(within(tokens).getByText('500,000 / 1,000,000')).toBeInTheDocument()
    expect(within(tokens).getByText('420,000')).toBeInTheDocument()
    expect(within(tokens).getByText('80,000')).toBeInTheDocument()
    expect(within(tokens).getAllByText('500,000')).toHaveLength(2)
    expect(within(tokens).getByText('1,000,000')).toBeInTheDocument()
    expect(within(usage).getByText(/北京时间重置：/)).toHaveTextContent('07/18 00:00')
  })

  it('clamps remaining budget and progress when usage exceeds the configured limits', async () => {
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
    expect(within(requests).queryByText('-50')).not.toBeInTheDocument()
    expect(within(tokens).queryByText('-100,000')).not.toBeInTheDocument()
    expect(within(requests).getByRole('progressbar')).toHaveAttribute('value', '300')
    expect(within(tokens).getByRole('progressbar')).toHaveAttribute('value', '1000000')
  })

  it('clears a submitted API key before the request settles and never persists it', async () => {
    const user = userEvent.setup()
    let resolveUpdate: ((value: typeof configured) => void) | undefined
    webChatConfigMocks.updateConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      }),
    )
    renderPage()

    await screen.findByText('v7')
    const model = screen.getByRole('textbox', { name: /^模型/ })
    const apiKey = screen.getByLabelText(/替换 API Key/)
    await user.clear(model)
    await user.type(model, 'gpt-5.6-sol')
    await user.type(apiKey, 'test_key_aaaaaaaaaaaaaaaa')
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '切换模型与正式密钥')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(apiKey).toHaveValue('')
    expect(webChatConfigMocks.updateConfig).toHaveBeenCalledWith({
      baseUrl: configured.baseUrl,
      model: 'gpt-5.6-sol',
      apiKey: 'test_key_aaaaaaaaaaaaaaaa',
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 7,
      reason: '切换模型与正式密钥',
    })
    expect(JSON.stringify(localStorage)).not.toContain('test_key_aaaaaaaaaaaaaaaa')
    expect(JSON.stringify(sessionStorage)).not.toContain('test_key_aaaaaaaaaaaaaaaa')

    resolveUpdate?.({ ...configured, model: 'gpt-5.6-sol', version: 8 })
    expect(await screen.findByText('WebChat 中转站配置已保存。')).toBeInTheDocument()
  })

  it('omits a blank API key when one is already configured', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('v7')
    const model = screen.getByRole('textbox', { name: /^模型/ })
    await user.clear(model)
    await user.type(model, 'gpt-5.6-sol')
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '仅更新模型别名')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(webChatConfigMocks.updateConfig).toHaveBeenCalledWith({
      baseUrl: configured.baseUrl,
      model: 'gpt-5.6-sol',
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 7,
      reason: '仅更新模型别名',
    })
  })

  it('lets an administrator pause requests and lower the shared daily budget', async () => {
    const user = userEvent.setup()
    webChatConfigMocks.fetchConfig.mockResolvedValue({ ...configured, requestsEnabled: true })
    renderPage()

    await screen.findByText('允许', { exact: true })
    await user.click(screen.getByRole('checkbox', { name: /允许成员发起 AI 请求/ }))
    const requestLimit = screen.getByRole('spinbutton', { name: /全站每日请求上限/ })
    const tokenLimit = screen.getByRole('spinbutton', { name: /全站每日 Token 上限/ })
    await user.clear(requestLimit)
    await user.type(requestLimit, '200')
    await user.clear(tokenLimit)
    await user.type(tokenLimit, '800000')
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '暂停服务并降低预算')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(webChatConfigMocks.updateConfig).toHaveBeenCalledWith({
      baseUrl: configured.baseUrl,
      model: configured.model,
      requestsEnabled: false,
      globalDailyRequestLimit: 200,
      globalDailyTokenLimit: 800_000,
      expectedVersion: 7,
      reason: '暂停服务并降低预算',
    })
  })

  it('requires an API key with at least 16 characters for the initial configuration', async () => {
    const user = userEvent.setup()
    webChatConfigMocks.fetchConfig.mockResolvedValue({
      baseUrl: '',
      model: '',
      apiKeyConfigured: false,
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      dailyUsage: configured.dailyUsage,
      version: 0,
      updatedAt: null,
    })
    renderPage()

    const baseUrl = await screen.findByRole('textbox', { name: /中转站 Base URL/ })
    expect(screen.getByText('尚未配置')).toBeInTheDocument()
    await user.type(baseUrl, 'https://relay.example.com/v1')
    await user.type(screen.getByRole('textbox', { name: /^模型/ }), 'gpt-5.6')
    await user.type(screen.getByLabelText(/API Key/), 'too-short')
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '首次接入中转站')

    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled()
    expect(webChatConfigMocks.updateConfig).not.toHaveBeenCalled()
  })

  it('rejects a relay endpoint with credentials, query data, or a Responses suffix', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('v7')
    const baseUrl = screen.getByRole('textbox', { name: /中转站 Base URL/ })
    await user.clear(baseUrl)
    await user.type(baseUrl, 'https://user:secret@relay.example.com/v1/responses?debug=1')
    await user.type(screen.getByRole('textbox', { name: /修改原因/ }), '测试非法地址校验')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(await screen.findByText('请输入有效的 HTTPS 中转站 Base URL。')).toBeInTheDocument()
    expect(webChatConfigMocks.updateConfig).not.toHaveBeenCalled()
  })

  it('clears an unsaved API key when the administrator refreshes configuration', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('v7')
    const apiKey = screen.getByLabelText(/替换 API Key/)
    await user.type(apiKey, 'test_key_bbbbbbbbbbbbbbbb')
    await user.click(screen.getByRole('button', { name: '刷新' }))

    await waitFor(() => expect(webChatConfigMocks.fetchConfig).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText(/替换 API Key/)).toHaveValue('')
  })

  it('keeps relay configuration usable when pilot observability fails independently', async () => {
    webChatConfigMocks.fetchPilotMembers.mockRejectedValue(new Error('成员观测服务暂时不可用'))
    renderPage()

    expect(await screen.findByText('v7')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /中转站 Base URL/ })).toHaveValue(configured.baseUrl)
    expect(await screen.findByRole('alert')).toHaveTextContent('成员观测服务暂时不可用')
    expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument()
  })

  it('keeps pilot observability available when relay configuration fails independently', async () => {
    webChatConfigMocks.fetchConfig.mockRejectedValue(new Error('中转站配置服务暂时不可用'))
    webChatConfigMocks.fetchPilotMembers.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000101',
        name: '试运行成员',
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
    expect(await screen.findByRole('region', { name: '试运行成员' })).toBeInTheDocument()
    expect(screen.getByText('8 / 30')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存配置' })).not.toBeInTheDocument()
  })
})
