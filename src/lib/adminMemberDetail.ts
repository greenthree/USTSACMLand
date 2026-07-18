import { supabase } from './supabase'
import { adminRpcError } from './adminRateLimit'
import {
  platforms,
  type AccountVerificationStatus,
  type AdminManualStatsInput,
  type AdminMemberActivity,
  type AdminMemberDetail,
  type AdminMemberPlatformDetail,
  type Platform,
  type ReviewStatus,
} from '../types/domain'

interface RpcResponse {
  data: unknown
  error: { message: string; code?: string } | null
}

type UntypedRpc = (functionName: string, args: Record<string, unknown>) => PromiseLike<RpcResponse>

interface AdminMemberDetailRow {
  id: string
  email: string | null
  full_name: string | null
  qq: string | null
  grade: string | null
  major: string | null
  review_status: Extract<ReviewStatus, 'approved' | 'suspended'>
  suspension_note: string | null
  is_public: boolean
  created_at: string
  updated_at: string
  platform: Platform
  account_id: number | string | null
  external_id: string | null
  account_status: AccountVerificationStatus | null
  verified_at: string | null
  verification_error_message: string | null
  account_updated_at: string | null
  current_rating: number | null
  max_rating: number | null
  solved_count: number | null
  stat_status: 'fresh' | 'stale' | 'unavailable' | null
  source_observed_at: string | null
  last_success_at: string | null
  stale_after: string | null
  source_version: string | null
  stat_updated_at: string | null
}

interface AdminMemberActivityRow {
  event_id: string
  event_kind: string
  target_table: string
  action: string
  platform: string | null
  run_status: string | null
  detail: string | null
  source_version: string | null
  created_at: string
}

function isPlatform(value: string | null): value is Platform {
  return value !== null && platforms.some((platform) => platform === value)
}

export function mapAdminMemberPlatform(row: AdminMemberDetailRow): AdminMemberPlatformDetail {
  return {
    platform: row.platform,
    accountId: row.account_id === null ? null : Number(row.account_id),
    externalId: row.external_id,
    accountStatus: row.account_status ?? 'missing',
    verifiedAt: row.verified_at,
    verificationErrorMessage: row.verification_error_message,
    accountUpdatedAt: row.account_updated_at,
    currentRating: row.current_rating,
    maxRating: row.max_rating,
    solvedCount: row.solved_count,
    statStatus: row.stat_status ?? 'missing',
    sourceObservedAt: row.source_observed_at,
    lastSuccessAt: row.last_success_at,
    staleAfter: row.stale_after,
    sourceVersion: row.source_version,
    statUpdatedAt: row.stat_updated_at,
  }
}

export function mapAdminMemberActivity(row: AdminMemberActivityRow): AdminMemberActivity {
  return {
    id: row.event_id,
    kind: row.event_kind === 'sync' ? 'sync' : 'audit',
    targetTable: row.target_table,
    action: row.action,
    platform: isPlatform(row.platform) ? row.platform : null,
    runStatus: row.run_status,
    detail: row.detail,
    sourceVersion: row.source_version,
    createdAt: row.created_at,
  }
}

export function mapAdminMemberDetail(
  rows: AdminMemberDetailRow[],
  activityRows: AdminMemberActivityRow[],
): AdminMemberDetail | null {
  const first = rows[0]
  if (!first) return null

  return {
    id: first.id,
    name: first.full_name ?? '未填写姓名',
    email: first.email ?? '--',
    qq: first.qq ?? '--',
    grade: first.grade ?? '未填写年级',
    major: first.major ?? '未填写专业',
    role: 'member',
    status: first.review_status === 'suspended' ? 'suspended' : 'active',
    suspensionNote: first.suspension_note,
    isPublic: first.is_public,
    joinedAt: first.created_at,
    updatedAt: first.updated_at,
    platformCount: rows.filter((row) => row.account_id !== null).length,
    verifiedPlatformCount: rows.filter((row) => row.account_status === 'verified').length,
    platforms: rows.map(mapAdminMemberPlatform),
    activity: activityRows.map(mapAdminMemberActivity),
  }
}

export async function fetchAdminMemberDetail(memberId: string): Promise<AdminMemberDetail | null> {
  if (!supabase) return null

  const [detailResult, activityResult] = await Promise.all([
    supabase.rpc('admin_get_member_detail', { target_profile_id: memberId }),
    supabase.rpc('admin_list_member_activity', {
      target_profile_id: memberId,
      row_limit: 20,
    }),
  ])

  if (detailResult.error) throw new Error(`成员详情读取失败：${detailResult.error.message}`)
  if (activityResult.error) throw new Error(`成员活动读取失败：${activityResult.error.message}`)

  return mapAdminMemberDetail(
    (detailResult.data ?? []) as AdminMemberDetailRow[],
    (activityResult.data ?? []) as AdminMemberActivityRow[],
  )
}

export async function upsertAdminMemberPlatformAccount(
  memberId: string,
  platform: Platform,
  externalId: string,
  expectedUpdatedAt: string | null,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.rpc('admin_upsert_member_platform_account', {
    target_profile_id: memberId,
    target_platform: platform,
    new_external_id: externalId,
    expected_updated_at: expectedUpdatedAt ?? undefined,
  })
  if (error) throw adminRpcError('平台账号保存失败', error)
}

export async function unbindAdminMemberPlatformAccount(
  memberId: string,
  platform: Platform,
  expectedUpdatedAt: string,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.rpc('admin_unbind_member_platform_account', {
    target_profile_id: memberId,
    target_platform: platform,
    expected_updated_at: expectedUpdatedAt,
  })
  if (error) throw adminRpcError('平台账号解绑失败', error)
}

export async function setAdminManualPlatformStats(
  memberId: string,
  platform: Platform,
  values: AdminManualStatsInput,
  expectedUpdatedAt: string | null,
): Promise<void> {
  if (!supabase) return

  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { error } = await rpc('admin_set_manual_platform_stats', {
    target_profile_id: memberId,
    target_platform: platform,
    manual_current_rating: values.currentRating,
    manual_max_rating: values.maxRating,
    manual_solved_count: values.solvedCount,
    manual_source_observed_at: values.sourceObservedAt,
    manual_note: values.note,
    expected_stat_updated_at: expectedUpdatedAt ?? undefined,
  })
  if (error) throw adminRpcError('手工数据保存失败', error)
}
