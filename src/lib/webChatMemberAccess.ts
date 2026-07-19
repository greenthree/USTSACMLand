import { adminRpcError } from './adminRateLimit'
import { supabase } from './supabase'

export interface WebChatMemberAccess {
  enabled: boolean
  pilotObservationEnabled: boolean
  totalRequestLimit: number
  totalTokenLimit: number
  version: number
  updatedAt: string | null
}

export interface WebChatMemberUsage {
  enabled: boolean
  model: string | null
  requests: {
    limit: number
    used: number
    remaining: number
  }
  tokens: {
    limit: number
    settled: number
    reserved: number
    remaining: number
  }
}

export interface UpdateWebChatMemberAccessInput {
  memberId: string
  enabled: boolean
  pilotObservationEnabled: boolean
  totalRequestLimit: number
  totalTokenLimit: number
  expectedVersion: number
  reason: string
}

interface WebChatMemberAccessRow {
  access_enabled: unknown
  pilot_observation_enabled: unknown
  total_request_limit: unknown
  total_token_limit: unknown
  version: unknown
  updated_at: unknown
}

interface WebChatMemberUsageRow {
  access_enabled: unknown
  model: unknown
  total_request_limit: unknown
  used_requests: unknown
  remaining_requests: unknown
  total_token_limit: unknown
  used_tokens: unknown
  reserved_tokens: unknown
  remaining_tokens: unknown
}

export class WebChatMemberAccessConflictError extends Error {
  constructor() {
    super('成员 AI 助手配置已被其他管理员修改，请刷新后重新确认。')
    this.name = 'WebChatMemberAccessConflictError'
  }
}

const demoAccess: WebChatMemberAccess = {
  enabled: true,
  pilotObservationEnabled: true,
  totalRequestLimit: 300,
  totalTokenLimit: 1_000_000,
  version: 1,
  updatedAt: '2026-07-17T08:00:00+08:00',
}

const demoUsage: WebChatMemberUsage = {
  enabled: true,
  model: 'gpt-5.6-sol',
  requests: { limit: 300, used: 8, remaining: 292 },
  tokens: { limit: 1_000_000, settled: 18_400, reserved: 0, remaining: 981_600 },
}

function singleRow(value: unknown, label: string): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label}返回了无效数据。`)
  }
  return row as Record<string, unknown>
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}返回了无效数据。`)
  }
  return value
}

function timestamp(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}返回了无效数据。`)
  }
  return value
}

export function mapWebChatMemberAccess(value: unknown): WebChatMemberAccess {
  const row = singleRow(value, '成员 AI 助手配置') as unknown as WebChatMemberAccessRow
  if (
    typeof row.access_enabled !== 'boolean' ||
    typeof row.pilot_observation_enabled !== 'boolean' ||
    (row.pilot_observation_enabled && !row.access_enabled)
  ) {
    throw new Error('成员 AI 助手配置返回了无效数据。')
  }

  return {
    enabled: row.access_enabled,
    pilotObservationEnabled: row.pilot_observation_enabled,
    totalRequestLimit: integer(row.total_request_limit, '成员累计请求总上限', 1),
    totalTokenLimit: integer(row.total_token_limit, '成员累计 Token 总上限', 100),
    version: integer(row.version, '成员 AI 助手配置版本'),
    updatedAt: timestamp(row.updated_at, '成员 AI 助手配置时间', true),
  }
}

export function mapWebChatMemberUsage(value: unknown): WebChatMemberUsage {
  const row = singleRow(value, 'AI 助手额度') as unknown as WebChatMemberUsageRow
  if (
    typeof row.access_enabled !== 'boolean' ||
    (row.model !== null &&
      (typeof row.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(row.model)))
  ) {
    throw new Error('AI 助手额度返回了无效数据。')
  }

  const requestLimit = integer(row.total_request_limit, '累计请求总上限', 1)
  const requestCount = integer(row.used_requests, '累计请求数')
  const remainingRequests = integer(row.remaining_requests, '剩余请求数')
  const tokenLimit = integer(row.total_token_limit, '累计 Token 总上限', 100)
  const settledTokens = integer(row.used_tokens, '累计已结算 Token')
  const reservedTokens = integer(row.reserved_tokens, '预留 Token')
  const remainingTokens = integer(row.remaining_tokens, '剩余 Token')

  if (
    remainingRequests !== Math.max(requestLimit - requestCount, 0) ||
    remainingTokens !== Math.max(tokenLimit - settledTokens - reservedTokens, 0)
  ) {
    throw new Error('AI 助手额度返回了不一致的数据。')
  }

  return {
    enabled: row.access_enabled,
    model: row.model as string | null,
    requests: { limit: requestLimit, used: requestCount, remaining: remainingRequests },
    tokens: {
      limit: tokenLimit,
      settled: settledTokens,
      reserved: reservedTokens,
      remaining: remainingTokens,
    },
  }
}

export async function fetchAdminWebChatMemberAccess(
  memberId: string,
): Promise<WebChatMemberAccess> {
  if (!supabase) return { ...demoAccess }

  const { data, error } = await supabase.rpc('admin_get_webchat_member_policy', {
    target_profile_id: memberId,
  })
  if (error) throw adminRpcError('成员 AI 助手配置读取失败', error)
  return mapWebChatMemberAccess(data)
}

export async function updateAdminWebChatMemberAccess(
  input: UpdateWebChatMemberAccessInput,
): Promise<WebChatMemberAccess> {
  if (!supabase) {
    return {
      enabled: input.enabled,
      pilotObservationEnabled: input.pilotObservationEnabled,
      totalRequestLimit: input.totalRequestLimit,
      totalTokenLimit: input.totalTokenLimit,
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    }
  }

  const { data, error } = await supabase.rpc('admin_update_webchat_member_policy', {
    target_profile_id: input.memberId,
    requested_access_enabled: input.enabled,
    requested_pilot_observation_enabled: input.pilotObservationEnabled,
    requested_total_request_limit: input.totalRequestLimit,
    requested_total_token_limit: input.totalTokenLimit,
    expected_version: input.expectedVersion,
    reason: input.reason.trim(),
  })
  if (error) {
    if (error.code === '40001') throw new WebChatMemberAccessConflictError()
    throw adminRpcError('成员 AI 助手配置保存失败', error)
  }
  return mapWebChatMemberAccess(data)
}

export async function fetchOwnWebChatUsage(): Promise<WebChatMemberUsage> {
  if (!supabase) return structuredClone(demoUsage)

  const { data, error } = await supabase.rpc('read_own_webchat_usage')
  if (error) throw new Error(`AI 助手额度读取失败：${error.message}`)
  return mapWebChatMemberUsage(data)
}
