import type { AdminFirecrawlKey, FirecrawlKeyHealthStatus } from '../types/domain'
import { adminFunctionError } from './adminRateLimit'
import { supabase } from './supabase'

export interface AdminFirecrawlKeyUpdate {
  keyId: string | null
  label: string
  apiKey?: string
  enabled: boolean
  priority: number
  expectedVersion: number | null
  reason: string
}

interface FunctionErrorLike {
  message: string
  context?: unknown
}

const healthStatuses = new Set<FirecrawlKeyHealthStatus>([
  'unknown',
  'healthy',
  'warning',
  'critical',
  'degraded',
  'rate_limited',
  'auth_failed',
])

const demoKeys: AdminFirecrawlKey[] = [
  {
    id: '00000000-0000-4000-8000-000000000301',
    label: '主额度池',
    keyConfigured: true,
    enabled: true,
    priority: 100,
    healthStatus: 'healthy',
    consecutiveFailures: 0,
    cooldownUntil: null,
    lastSelectedAt: '2026-07-19T07:00:00+08:00',
    lastCheckedAt: '2026-07-19T07:00:00+08:00',
    lastSuccessAt: '2026-07-19T07:00:00+08:00',
    lastFailureAt: null,
    lastErrorCode: null,
    creditsRemaining: 409,
    creditsTotal: 1000,
    billingPeriodEnd: '2026-07-24T12:37:07.733Z',
    version: 2,
    createdAt: '2026-07-18T08:00:00+08:00',
    updatedAt: '2026-07-19T07:00:00+08:00',
  },
]

export class AdminFirecrawlKeyError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'AdminFirecrawlKeyError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function optionalInteger(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

export function parseAdminFirecrawlKey(value: unknown): AdminFirecrawlKey {
  if (!isRecord(value)) throw new AdminFirecrawlKeyError('Firecrawl 配置服务返回了无效数据。')
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.keyConfigured !== 'boolean' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.priority !== 'number' ||
    !Number.isSafeInteger(value.priority) ||
    typeof value.healthStatus !== 'string' ||
    !healthStatuses.has(value.healthStatus as FirecrawlKeyHealthStatus) ||
    typeof value.consecutiveFailures !== 'number' ||
    !Number.isSafeInteger(value.consecutiveFailures) ||
    !optionalTimestamp(value.cooldownUntil) ||
    !optionalTimestamp(value.lastSelectedAt) ||
    !optionalTimestamp(value.lastCheckedAt) ||
    !optionalTimestamp(value.lastSuccessAt) ||
    !optionalTimestamp(value.lastFailureAt) ||
    (value.lastErrorCode !== null && typeof value.lastErrorCode !== 'string') ||
    !optionalInteger(value.creditsRemaining) ||
    !optionalInteger(value.creditsTotal) ||
    !optionalTimestamp(value.billingPeriodEnd) ||
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new AdminFirecrawlKeyError('Firecrawl 配置服务返回了无效数据。')
  }
  return value as unknown as AdminFirecrawlKey
}

async function firecrawlFunctionError(prefix: string, error: FunctionErrorLike): Promise<Error> {
  if (error.context instanceof Response) {
    try {
      const body = (await error.context.clone().json()) as unknown
      if (isRecord(body)) {
        const structured = isRecord(body.error) ? body.error : body
        const message = typeof structured.message === 'string' ? structured.message.trim() : ''
        const code = typeof structured.code === 'string' ? structured.code : null
        if (message) return new AdminFirecrawlKeyError(`${prefix}：${message}`, code)
      }
    } catch {
      // Fall through to the shared administrator error formatter.
    }
  }
  return adminFunctionError(prefix, error)
}

export async function fetchAdminFirecrawlKeys(): Promise<AdminFirecrawlKey[]> {
  if (!supabase) return demoKeys
  const { data, error } = await supabase.functions.invoke('firecrawl-config', {
    body: { action: 'read' },
  })
  if (error) throw await firecrawlFunctionError('Firecrawl Key 读取失败', error)
  if (!isRecord(data) || !Array.isArray(data.keys)) {
    throw new AdminFirecrawlKeyError('Firecrawl Key 读取失败：服务端未返回列表。')
  }
  return data.keys.map(parseAdminFirecrawlKey)
}

export async function upsertAdminFirecrawlKey(
  input: AdminFirecrawlKeyUpdate,
): Promise<AdminFirecrawlKey> {
  const apiKey = input.apiKey?.trim()
  if (!supabase) {
    const previous = input.keyId ? demoKeys.find((key) => key.id === input.keyId) : null
    return {
      ...(previous ?? demoKeys[0]),
      id: input.keyId ?? crypto.randomUUID(),
      label: input.label,
      keyConfigured: Boolean(apiKey) || Boolean(previous?.keyConfigured),
      enabled: input.enabled,
      priority: input.priority,
      healthStatus: apiKey ? 'unknown' : (previous?.healthStatus ?? 'unknown'),
      version: (input.expectedVersion ?? -1) + 1,
      updatedAt: new Date().toISOString(),
    }
  }
  const { data, error } = await supabase.functions.invoke('firecrawl-config', {
    body: {
      action: 'upsert',
      keyId: input.keyId,
      label: input.label,
      ...(apiKey ? { apiKey } : {}),
      enabled: input.enabled,
      priority: input.priority,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    },
  })
  if (error) throw await firecrawlFunctionError('Firecrawl Key 保存失败', error)
  if (!isRecord(data) || !('key' in data)) {
    throw new AdminFirecrawlKeyError('Firecrawl Key 保存失败：服务端未返回配置。')
  }
  return parseAdminFirecrawlKey(data.key)
}

export async function deleteAdminFirecrawlKey(
  keyId: string,
  expectedVersion: number,
  reason: string,
): Promise<string> {
  if (!supabase) return keyId
  const { data, error } = await supabase.functions.invoke('firecrawl-config', {
    body: { action: 'delete', keyId, expectedVersion, reason },
  })
  if (error) throw await firecrawlFunctionError('Firecrawl Key 删除失败', error)
  if (!isRecord(data) || data.deletedKeyId !== keyId) {
    throw new AdminFirecrawlKeyError('Firecrawl Key 删除失败：服务端返回无效结果。')
  }
  return keyId
}

export async function checkAdminFirecrawlKey(
  keyId: string,
): Promise<{ key: AdminFirecrawlKey; succeeded: boolean; errorCode: string | null }> {
  if (!supabase) return { key: demoKeys[0], succeeded: true, errorCode: null }
  const { data, error } = await supabase.functions.invoke('firecrawl-config', {
    body: { action: 'check', keyId },
  })
  if (error) throw await firecrawlFunctionError('Firecrawl Key 检查失败', error)
  if (
    !isRecord(data) ||
    !isRecord(data.check) ||
    typeof data.check.succeeded !== 'boolean' ||
    (data.check.errorCode !== null && typeof data.check.errorCode !== 'string')
  ) {
    throw new AdminFirecrawlKeyError('Firecrawl Key 检查失败：服务端返回无效结果。')
  }
  return {
    key: parseAdminFirecrawlKey(data.check.key),
    succeeded: data.check.succeeded,
    errorCode: data.check.errorCode as string | null,
  }
}
