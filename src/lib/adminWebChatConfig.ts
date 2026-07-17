import { adminFunctionError } from './adminRateLimit'
import { supabase } from './supabase'

export interface AdminWebChatConfig {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  requestsEnabled: boolean
  globalDailyRequestLimit: number
  globalDailyTokenLimit: number
  version: number
  updatedAt: string | null
  dailyUsage: {
    usageDate: string
    requestCount: number
    settledTokens: number
    reservedTokens: number
    resetAt: string
    requestBudgetAlertedAt: string | null
    tokenBudgetAlertedAt: string | null
  }
}

export interface AdminWebChatConfigUpdate {
  baseUrl: string
  model: string
  apiKey?: string
  requestsEnabled: boolean
  globalDailyRequestLimit: number
  globalDailyTokenLimit: number
  expectedVersion: number
  reason: string
}

interface FunctionErrorLike {
  message: string
  context?: unknown
  details?: unknown
}

const demoConfig: AdminWebChatConfig = {
  baseUrl: 'https://relay.example.com/v1',
  model: 'gpt-5.6',
  apiKeyConfigured: true,
  requestsEnabled: false,
  globalDailyRequestLimit: 300,
  globalDailyTokenLimit: 1_000_000,
  version: 1,
  updatedAt: '2026-07-17T08:00:00+08:00',
  dailyUsage: {
    usageDate: '2026-07-17',
    requestCount: 128,
    settledTokens: 420_000,
    reservedTokens: 80_000,
    resetAt: '2026-07-17T16:00:00Z',
    requestBudgetAlertedAt: null,
    tokenBudgetAlertedAt: null,
  },
}

export class AdminWebChatConfigError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'AdminWebChatConfigError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConfig(value: unknown, operation: string): AdminWebChatConfig {
  if (!isRecord(value) || !isRecord(value.config)) {
    throw new AdminWebChatConfigError(`${operation}：服务端未返回配置。`)
  }

  const config = value.config
  const dailyUsage = isRecord(config.dailyUsage) ? config.dailyUsage : null
  const numericVersion =
    typeof config.version === 'number'
      ? config.version
      : typeof config.version === 'string'
        ? Number(config.version)
        : Number.NaN

  if (
    typeof config.baseUrl !== 'string' ||
    typeof config.model !== 'string' ||
    typeof config.apiKeyConfigured !== 'boolean' ||
    typeof config.requestsEnabled !== 'boolean' ||
    typeof config.globalDailyRequestLimit !== 'number' ||
    !Number.isSafeInteger(config.globalDailyRequestLimit) ||
    config.globalDailyRequestLimit < 1 ||
    typeof config.globalDailyTokenLimit !== 'number' ||
    !Number.isSafeInteger(config.globalDailyTokenLimit) ||
    config.globalDailyTokenLimit < 100 ||
    !Number.isSafeInteger(numericVersion) ||
    numericVersion < 0 ||
    (config.updatedAt !== null && typeof config.updatedAt !== 'string') ||
    !dailyUsage ||
    typeof dailyUsage.usageDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dailyUsage.usageDate) ||
    typeof dailyUsage.requestCount !== 'number' ||
    !Number.isSafeInteger(dailyUsage.requestCount) ||
    dailyUsage.requestCount < 0 ||
    typeof dailyUsage.settledTokens !== 'number' ||
    !Number.isSafeInteger(dailyUsage.settledTokens) ||
    dailyUsage.settledTokens < 0 ||
    typeof dailyUsage.reservedTokens !== 'number' ||
    !Number.isSafeInteger(dailyUsage.reservedTokens) ||
    dailyUsage.reservedTokens < 0 ||
    typeof dailyUsage.resetAt !== 'string' ||
    !Number.isFinite(Date.parse(dailyUsage.resetAt)) ||
    (dailyUsage.requestBudgetAlertedAt !== null &&
      (typeof dailyUsage.requestBudgetAlertedAt !== 'string' ||
        !Number.isFinite(Date.parse(dailyUsage.requestBudgetAlertedAt)))) ||
    (dailyUsage.tokenBudgetAlertedAt !== null &&
      (typeof dailyUsage.tokenBudgetAlertedAt !== 'string' ||
        !Number.isFinite(Date.parse(dailyUsage.tokenBudgetAlertedAt))))
  ) {
    throw new AdminWebChatConfigError(`${operation}：服务端返回了无效配置。`)
  }

  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: config.apiKeyConfigured,
    requestsEnabled: config.requestsEnabled,
    globalDailyRequestLimit: config.globalDailyRequestLimit,
    globalDailyTokenLimit: config.globalDailyTokenLimit,
    version: numericVersion,
    updatedAt: config.updatedAt,
    dailyUsage: {
      usageDate: dailyUsage.usageDate,
      requestCount: dailyUsage.requestCount,
      settledTokens: dailyUsage.settledTokens,
      reservedTokens: dailyUsage.reservedTokens,
      resetAt: dailyUsage.resetAt,
      requestBudgetAlertedAt: dailyUsage.requestBudgetAlertedAt,
      tokenBudgetAlertedAt: dailyUsage.tokenBudgetAlertedAt,
    },
  }
}

async function webChatConfigFunctionError(
  prefix: string,
  error: FunctionErrorLike,
): Promise<Error> {
  if (error.context instanceof Response) {
    if (error.context.status === 429) return adminFunctionError(prefix, error)
    try {
      const body = (await error.context.clone().json()) as unknown
      if (isRecord(body)) {
        const structured = isRecord(body.error) ? body.error : body
        const message = typeof structured.message === 'string' ? structured.message.trim() : ''
        const code = typeof structured.code === 'string' ? structured.code : null
        if (message) return new AdminWebChatConfigError(`${prefix}：${message}`, code)
      }
    } catch {
      // Fall back to the shared Edge Function error formatter below.
    }
  }
  return adminFunctionError(prefix, error)
}

export async function fetchAdminWebChatConfig(): Promise<AdminWebChatConfig> {
  if (!supabase) return demoConfig

  const { data, error } = await supabase.functions.invoke('webchat-config', {
    body: { action: 'read' },
  })
  if (error) throw await webChatConfigFunctionError('WebChat 配置读取失败', error)
  return parseConfig(data, 'WebChat 配置读取失败')
}

export async function updateAdminWebChatConfig(
  input: AdminWebChatConfigUpdate,
): Promise<AdminWebChatConfig> {
  const apiKey = input.apiKey?.trim()
  if (!supabase) {
    return {
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyConfigured: Boolean(apiKey) || demoConfig.apiKeyConfigured,
      requestsEnabled: input.requestsEnabled,
      globalDailyRequestLimit: input.globalDailyRequestLimit,
      globalDailyTokenLimit: input.globalDailyTokenLimit,
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
      dailyUsage: demoConfig.dailyUsage,
    }
  }

  const { data, error } = await supabase.functions.invoke('webchat-config', {
    body: {
      action: 'update',
      baseUrl: input.baseUrl,
      model: input.model,
      ...(apiKey ? { apiKey } : {}),
      requestsEnabled: input.requestsEnabled,
      globalDailyRequestLimit: input.globalDailyRequestLimit,
      globalDailyTokenLimit: input.globalDailyTokenLimit,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    },
  })
  if (error) throw await webChatConfigFunctionError('WebChat 配置保存失败', error)
  return parseConfig(data, 'WebChat 配置保存失败')
}
