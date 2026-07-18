import { adminRpcError } from './adminRateLimit'
import { supabase } from './supabase'

export type WebChatPilotRole = 'member' | 'admin'
export type WebChatPilotAccountStatus = 'approved' | 'suspended'

export interface AdminWebChatPilotMember {
  id: string
  name: string
  grade: string | null
  major: string | null
  role: WebChatPilotRole
  accountStatus: WebChatPilotAccountStatus
  accessEnabled: boolean
  totalRequestLimit: number
  totalTokenLimit: number
  requestCount: number
  settledTokens: number
  reservedTokens: number
  remainingRequests: number
  remainingTokens: number
  activeRequestCount: number
  lastRequestAt: string | null
  version: number
  updatedAt: string
}

export interface AdminWebChatCacheSummary {
  observedRequests: number
  eligibleRequests: number
  cacheHitRequests: number
  eligibleInputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
}

interface AdminWebChatPilotMemberRow {
  user_id: string
  full_name: string | null
  grade: string | null
  major: string | null
  role: string
  review_status: string
  access_enabled: boolean
  total_request_limit: number | string
  total_token_limit: number | string
  used_requests: number | string
  used_tokens: number | string
  reserved_tokens: number | string
  remaining_requests: number | string
  remaining_tokens: number | string
  active_request_count: number | string
  last_request_at: string | null
  version: number | string
  updated_at: string
}

interface AdminWebChatCacheSummaryRow {
  observed_requests: number | string
  eligible_requests: number | string
  cache_hit_requests: number | string
  eligible_input_tokens: number | string
  cached_input_tokens: number | string
  cache_write_tokens: number | string
}

const demoMembers: AdminWebChatPilotMember[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: '试运行成员',
    grade: '24级',
    major: '计算机科学与技术',
    role: 'member',
    accountStatus: 'approved',
    accessEnabled: true,
    totalRequestLimit: 300,
    totalTokenLimit: 1_000_000,
    requestCount: 8,
    settledTokens: 18_420,
    reservedTokens: 4_000,
    remainingRequests: 292,
    remainingTokens: 977_580,
    activeRequestCount: 1,
    lastRequestAt: '2026-07-18T08:30:00+08:00',
    version: 2,
    updatedAt: '2026-07-17T20:00:00+08:00',
  },
]

const demoCacheSummary: AdminWebChatCacheSummary = {
  observedRequests: 0,
  eligibleRequests: 0,
  cacheHitRequests: 0,
  eligibleInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function integer(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`试运行成员列表返回了无效的${label}。`)
  }
  return parsed
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`试运行成员列表返回了无效的${label}。`)
  }
  return value
}

function mapPilotMember(row: AdminWebChatPilotMemberRow): AdminWebChatPilotMember {
  if (
    !uuidPattern.test(row.user_id) ||
    typeof row.access_enabled !== 'boolean' ||
    !['member', 'admin'].includes(row.role) ||
    !['approved', 'suspended'].includes(row.review_status)
  ) {
    throw new Error('试运行成员列表返回了无效数据。')
  }

  const totalRequestLimit = integer(row.total_request_limit, '累计请求总上限')
  const totalTokenLimit = integer(row.total_token_limit, '累计 Token 总上限')
  const requestCount = integer(row.used_requests, '累计请求数')
  const settledTokens = integer(row.used_tokens, '累计已结算 Token')
  const reservedTokens = integer(row.reserved_tokens, '预留 Token')
  const remainingRequests = integer(row.remaining_requests, '剩余请求数')
  const remainingTokens = integer(row.remaining_tokens, '剩余 Token')
  const activeRequestCount = integer(row.active_request_count, '活动请求数')
  const version = integer(row.version, '配置版本')

  if (
    totalRequestLimit < 1 ||
    totalTokenLimit < 100 ||
    version < 1 ||
    activeRequestCount > 1 ||
    remainingRequests !== Math.max(totalRequestLimit - requestCount, 0) ||
    remainingTokens !== Math.max(totalTokenLimit - settledTokens - reservedTokens, 0)
  ) {
    throw new Error('试运行成员列表返回了不一致的额度数据。')
  }

  return {
    id: row.user_id,
    name: row.full_name?.trim() || '未填写姓名',
    grade: row.grade?.trim() || null,
    major: row.major?.trim() || null,
    role: row.role as WebChatPilotRole,
    accountStatus: row.review_status as WebChatPilotAccountStatus,
    accessEnabled: row.access_enabled,
    totalRequestLimit,
    totalTokenLimit,
    requestCount,
    settledTokens,
    reservedTokens,
    remainingRequests,
    remainingTokens,
    activeRequestCount,
    lastRequestAt: timestamp(row.last_request_at, '最近请求时间'),
    version,
    updatedAt: timestamp(row.updated_at, '配置更新时间') as string,
  }
}

export function mapAdminWebChatPilotMembers(value: unknown): AdminWebChatPilotMember[] {
  if (!Array.isArray(value)) {
    throw new Error('试运行成员列表返回了无效数据。')
  }
  return (value as AdminWebChatPilotMemberRow[]).map(mapPilotMember)
}

export async function fetchAdminWebChatPilotMembers(): Promise<AdminWebChatPilotMember[]> {
  if (!supabase) return demoMembers

  const { data, error } = await supabase.rpc('admin_list_webchat_pilot_members')
  if (error) throw adminRpcError('试运行成员用量读取失败', error)
  return mapAdminWebChatPilotMembers(data)
}

export function mapAdminWebChatCacheSummary(value: unknown): AdminWebChatCacheSummary {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('WebChat 输入缓存摘要返回了无效数据。')
  }
  const data = row as AdminWebChatCacheSummaryRow
  const summary = {
    observedRequests: integer(data.observed_requests, '可观测缓存请求数'),
    eligibleRequests: integer(data.eligible_requests, '达到缓存门槛的请求数'),
    cacheHitRequests: integer(data.cache_hit_requests, '缓存命中请求数'),
    eligibleInputTokens: integer(data.eligible_input_tokens, '可缓存输入 Token'),
    cachedInputTokens: integer(data.cached_input_tokens, '已命中输入 Token'),
    cacheWriteTokens: integer(data.cache_write_tokens, '缓存写入 Token'),
  }
  if (
    summary.eligibleRequests > summary.observedRequests ||
    summary.cacheHitRequests > summary.eligibleRequests ||
    summary.cachedInputTokens > summary.eligibleInputTokens
  ) {
    throw new Error('WebChat 输入缓存摘要返回了不一致数据。')
  }
  return summary
}

export async function fetchAdminWebChatCacheSummary(): Promise<AdminWebChatCacheSummary> {
  if (!supabase) return demoCacheSummary

  const { data, error } = await supabase.rpc('admin_read_webchat_cache_summary')
  if (error) throw adminRpcError('WebChat 输入缓存摘要读取失败', error)
  return mapAdminWebChatCacheSummary(data)
}
