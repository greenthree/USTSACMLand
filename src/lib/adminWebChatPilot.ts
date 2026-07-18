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
  dailyRequestLimit: number
  dailyTokenLimit: number
  usageDate: string
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

interface AdminWebChatPilotMemberRow {
  user_id: string
  full_name: string | null
  grade: string | null
  major: string | null
  role: string
  review_status: string
  access_enabled: boolean
  daily_request_limit: number | string
  daily_token_limit: number | string
  usage_date: string
  request_count: number | string
  settled_tokens: number | string
  reserved_tokens: number | string
  remaining_requests: number | string
  remaining_tokens: number | string
  active_request_count: number | string
  last_request_at: string | null
  version: number | string
  updated_at: string
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
    dailyRequestLimit: 30,
    dailyTokenLimit: 100_000,
    usageDate: '2026-07-18',
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
]

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
    !/^\d{4}-\d{2}-\d{2}$/.test(row.usage_date) ||
    !['member', 'admin'].includes(row.role) ||
    !['approved', 'suspended'].includes(row.review_status)
  ) {
    throw new Error('试运行成员列表返回了无效数据。')
  }

  const dailyRequestLimit = integer(row.daily_request_limit, '每日请求上限')
  const dailyTokenLimit = integer(row.daily_token_limit, '每日 Token 上限')
  const requestCount = integer(row.request_count, '今日请求数')
  const settledTokens = integer(row.settled_tokens, '已结算 Token')
  const reservedTokens = integer(row.reserved_tokens, '预留 Token')
  const remainingRequests = integer(row.remaining_requests, '剩余请求数')
  const remainingTokens = integer(row.remaining_tokens, '剩余 Token')
  const activeRequestCount = integer(row.active_request_count, '活动请求数')
  const version = integer(row.version, '配置版本')

  if (
    dailyRequestLimit < 1 ||
    dailyTokenLimit < 100 ||
    version < 1 ||
    activeRequestCount > 1 ||
    remainingRequests !== Math.max(dailyRequestLimit - requestCount, 0) ||
    remainingTokens !== Math.max(dailyTokenLimit - settledTokens - reservedTokens, 0)
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
    dailyRequestLimit,
    dailyTokenLimit,
    usageDate: row.usage_date,
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
