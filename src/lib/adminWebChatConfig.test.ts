const configMocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: configMocks.invoke } },
}))

import {
  AdminWebChatConfigError,
  fetchAdminWebChatConfig,
  updateAdminWebChatConfig,
} from './adminWebChatConfig'

const config = {
  baseUrl: 'https://relay.example.com/v1',
  model: 'gpt-5.6',
  apiKeyConfigured: true,
  requestsEnabled: false,
  globalDailyRequestLimit: 300,
  globalDailyTokenLimit: 1_000_000,
  version: 7,
  updatedAt: '2026-07-17T08:00:00Z',
  dailyUsage: {
    usageDate: '2026-07-17',
    requestCount: 28,
    settledTokens: 940_000,
    reservedTokens: 40_000,
    resetAt: '2026-07-17T16:00:00Z',
    requestBudgetAlertedAt: null,
    tokenBudgetAlertedAt: '2026-07-17T10:00:00Z',
  },
}

describe('administrator WebChat configuration operations', () => {
  beforeEach(() => {
    configMocks.invoke.mockReset()
  })

  it('reads the redacted configuration through the Edge Function', async () => {
    configMocks.invoke.mockResolvedValue({ data: { config }, error: null })

    await expect(fetchAdminWebChatConfig()).resolves.toEqual(config)
    expect(configMocks.invoke).toHaveBeenCalledWith('webchat-config', {
      body: { action: 'read' },
    })
  })

  it('accepts the unconfigured singleton at version zero', async () => {
    const initialConfig = {
      baseUrl: '',
      model: '',
      apiKeyConfigured: false,
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      version: 0,
      updatedAt: '2026-07-17T00:00:00Z',
      dailyUsage: {
        usageDate: '2026-07-17',
        requestCount: 0,
        settledTokens: 0,
        reservedTokens: 0,
        resetAt: '2026-07-17T16:00:00Z',
        requestBudgetAlertedAt: null,
        tokenBudgetAlertedAt: null,
      },
    }
    configMocks.invoke.mockResolvedValue({ data: { config: initialConfig }, error: null })

    await expect(fetchAdminWebChatConfig()).resolves.toEqual(initialConfig)
  })

  it('rejects malformed aggregate budget usage from the service', async () => {
    configMocks.invoke.mockResolvedValue({
      data: {
        config: {
          ...config,
          dailyUsage: { ...config.dailyUsage, reservedTokens: -1 },
        },
      },
      error: null,
    })

    await expect(fetchAdminWebChatConfig()).rejects.toThrow(/无效配置/)
  })

  it('sends the optimistic-lock version, reason, and a replacement API key', async () => {
    configMocks.invoke.mockResolvedValue({
      data: { config: { ...config, version: 8 } },
      error: null,
    })

    await updateAdminWebChatConfig({
      baseUrl: 'https://new-relay.example.com/v1',
      model: 'gpt-5.6',
      apiKey: '  replacement-secret  ',
      requestsEnabled: true,
      globalDailyRequestLimit: 400,
      globalDailyTokenLimit: 1_200_000,
      expectedVersion: 7,
      reason: '切换正式中转站',
    })

    expect(configMocks.invoke).toHaveBeenCalledWith('webchat-config', {
      body: {
        action: 'update',
        baseUrl: 'https://new-relay.example.com/v1',
        model: 'gpt-5.6',
        apiKey: 'replacement-secret',
        requestsEnabled: true,
        globalDailyRequestLimit: 400,
        globalDailyTokenLimit: 1_200_000,
        expectedVersion: 7,
        reason: '切换正式中转站',
      },
    })
  })

  it('omits a blank API key so the existing secret remains configured', async () => {
    configMocks.invoke.mockResolvedValue({ data: { config }, error: null })

    await updateAdminWebChatConfig({
      baseUrl: config.baseUrl,
      model: 'gpt-5.6-sol',
      apiKey: '   ',
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 7,
      reason: '仅更新模型别名',
    })

    expect(configMocks.invoke).toHaveBeenCalledWith('webchat-config', {
      body: {
        action: 'update',
        baseUrl: config.baseUrl,
        model: 'gpt-5.6-sol',
        requestsEnabled: false,
        globalDailyRequestLimit: 300,
        globalDailyTokenLimit: 1_000_000,
        expectedVersion: 7,
        reason: '仅更新模型别名',
      },
    })
  })

  it('preserves structured conflict information from the Edge Function', async () => {
    configMocks.invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(
          JSON.stringify({
            error: { code: 'version_conflict', message: '配置已被其他管理员更新' },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      },
    })

    const error = await updateAdminWebChatConfig({
      baseUrl: config.baseUrl,
      model: config.model,
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      expectedVersion: 6,
      reason: '测试冲突',
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(AdminWebChatConfigError)
    expect(error).toMatchObject({
      code: 'version_conflict',
      message: 'WebChat 配置保存失败：配置已被其他管理员更新',
    })
  })
})
