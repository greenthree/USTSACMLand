import { adminFunctionError } from './adminRateLimit'
import { supabase, supabaseUrl } from './supabase'

export interface AdminAuthCaptchaConfig {
  enabled: boolean
  version: number
  updatedAt: string
}

export interface AdminAuthCaptchaUpdate {
  enabled: boolean
  expectedVersion: number
  reason: string
}

const demoConfig: AdminAuthCaptchaConfig = {
  enabled: false,
  version: 1,
  updatedAt: '2026-09-08T00:00:00.000Z',
}

function parseConfig(value: unknown): AdminAuthCaptchaConfig {
  const config = (value as { config?: unknown } | null)?.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Auth CAPTCHA 配置读取失败：服务端未返回配置。')
  }
  const record = config as Record<string, unknown>
  if (
    typeof record.enabled !== 'boolean' ||
    !Number.isSafeInteger(Number(record.version)) ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    throw new Error('Auth CAPTCHA 配置读取失败：服务端返回了无效配置。')
  }
  return {
    enabled: record.enabled,
    version: Number(record.version),
    updatedAt: record.updatedAt,
  }
}

async function mapError(
  prefix: string,
  error: { context?: unknown; message: string },
): Promise<Error> {
  if (error.context instanceof Response && error.context.status === 429) {
    return adminFunctionError(prefix, error)
  }
  return new Error(`${prefix}：${error.message ?? '服务暂时不可用'}`)
}

export async function fetchAdminAuthCaptchaConfig(): Promise<AdminAuthCaptchaConfig> {
  if (!supabase) return demoConfig
  if (!supabaseUrl) throw new Error('Auth CAPTCHA 配置读取失败：Supabase 尚未配置。')
  let response: Response
  try {
    response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/auth-captcha-config`, {
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    throw await mapError('Auth CAPTCHA 配置读取失败', {
      context: error,
      message: error instanceof Error ? error.message : '网络请求失败',
    })
  }
  if (!response.ok) throw new Error(`Auth CAPTCHA 配置读取失败：HTTP ${response.status}`)
  return parseConfig(await response.json())
}

export async function updateAdminAuthCaptchaConfig(
  input: AdminAuthCaptchaUpdate,
): Promise<AdminAuthCaptchaConfig> {
  if (!supabase) {
    return {
      enabled: input.enabled,
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    }
  }
  const { data, error } = await supabase.functions.invoke('auth-captcha-config', {
    body: input,
  })
  if (error) throw await mapError('Auth CAPTCHA 配置更新失败', error)
  return parseConfig(data)
}
