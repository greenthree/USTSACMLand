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
  pilotObservationEnabled: boolean
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

export type WebChatPilotObservationStatus =
  | 'cohort_size_invalid'
  | 'active_requests'
  | 'needs_review'
  | 'awaiting_member_activity'
  | 'observing'
  | 'ready_for_review'

export interface AdminWebChatPilotObservation {
  checkedAt: string
  cohortStartedAt: string | null
  observationHours: number
  enabledMembers: number
  activeMembers: number
  observedRequests: number
  successfulRequests: number
  incompleteRequests: number
  failedRequests: number
  unknownUsageRequests: number
  activeGenerationCount: number
  cacheEligibleRequests: number
  cacheHitRequests: number
  lastRequestAt: string | null
  status: WebChatPilotObservationStatus
}

interface AdminWebChatPilotMemberRow {
  user_id: string
  full_name: string | null
  grade: string | null
  major: string | null
  role: string
  review_status: string
  access_enabled: boolean
  pilot_observation_enabled: boolean
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

interface AdminWebChatPilotObservationRow {
  checked_at: string
  cohort_started_at: string | null
  observation_hours: number | string
  enabled_members: number | string
  active_members: number | string
  observed_requests: number | string
  successful_requests: number | string
  incomplete_requests: number | string
  failed_requests: number | string
  unknown_usage_requests: number | string
  active_generation_count: number | string
  cache_eligible_requests: number | string
  cache_hit_requests: number | string
  last_request_at: string | null
  observation_status: string
}

const demoMembers: AdminWebChatPilotMember[] = [
  {
    id: 'member-1',
    name: '试运行成员',
    grade: '24级',
    major: '计算机科学与技术',
    role: 'member',
    accountStatus: 'approved',
    accessEnabled: true,
    pilotObservationEnabled: true,
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

const demoObservation: AdminWebChatPilotObservation = {
  checkedAt: '2026-07-19T09:30:00+08:00',
  cohortStartedAt: '2026-07-18T09:30:00+08:00',
  observationHours: 24,
  enabledMembers: 1,
  activeMembers: 1,
  observedRequests: 8,
  successfulRequests: 8,
  incompleteRequests: 0,
  failedRequests: 0,
  unknownUsageRequests: 0,
  activeGenerationCount: 0,
  cacheEligibleRequests: 2,
  cacheHitRequests: 1,
  lastRequestAt: '2026-07-19T09:20:00+08:00',
  status: 'cohort_size_invalid',
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
    typeof row.pilot_observation_enabled !== 'boolean' ||
    (row.pilot_observation_enabled && !row.access_enabled) ||
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
    pilotObservationEnabled: row.pilot_observation_enabled,
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

const observationStatuses = new Set<WebChatPilotObservationStatus>([
  'cohort_size_invalid',
  'active_requests',
  'needs_review',
  'awaiting_member_activity',
  'observing',
  'ready_for_review',
])

export function mapAdminWebChatPilotObservation(value: unknown): AdminWebChatPilotObservation {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('WebChat 试运行观察摘要返回了无效数据。')
  }
  const data = row as AdminWebChatPilotObservationRow
  if (!observationStatuses.has(data.observation_status as WebChatPilotObservationStatus)) {
    throw new Error('WebChat 试运行观察摘要返回了无效状态。')
  }

  const observation = {
    checkedAt: timestamp(data.checked_at, '观察检查时间') as string,
    cohortStartedAt: timestamp(data.cohort_started_at, '观察开始时间'),
    observationHours: integer(data.observation_hours, '连续观察小时数'),
    enabledMembers: integer(data.enabled_members, '正式试运行成员数'),
    activeMembers: integer(data.active_members, '已有活动成员数'),
    observedRequests: integer(data.observed_requests, '观察请求数'),
    successfulRequests: integer(data.successful_requests, '成功请求数'),
    incompleteRequests: integer(data.incomplete_requests, '不完整请求数'),
    failedRequests: integer(data.failed_requests, '失败请求数'),
    unknownUsageRequests: integer(data.unknown_usage_requests, '未知用量请求数'),
    activeGenerationCount: integer(data.active_generation_count, '进行中生成数'),
    cacheEligibleRequests: integer(data.cache_eligible_requests, '缓存达标请求数'),
    cacheHitRequests: integer(data.cache_hit_requests, '缓存命中请求数'),
    lastRequestAt: timestamp(data.last_request_at, '最近观察请求时间'),
    status: data.observation_status as WebChatPilotObservationStatus,
  }

  if (
    observation.activeMembers > observation.enabledMembers ||
    observation.successfulRequests + observation.incompleteRequests + observation.failedRequests !==
      observation.observedRequests ||
    observation.unknownUsageRequests > observation.observedRequests ||
    observation.cacheHitRequests > observation.cacheEligibleRequests ||
    (observation.enabledMembers > 0 && observation.cohortStartedAt === null) ||
    (observation.lastRequestAt !== null && observation.cohortStartedAt === null)
  ) {
    throw new Error('WebChat 试运行观察摘要返回了不一致数据。')
  }

  return observation
}

export async function fetchAdminWebChatPilotObservation(): Promise<AdminWebChatPilotObservation> {
  if (!supabase) return demoObservation

  const { data, error } = await supabase.rpc('admin_read_webchat_pilot_observation')
  if (error) throw adminRpcError('WebChat 试运行观察摘要读取失败', error)
  return mapAdminWebChatPilotObservation(data)
}
