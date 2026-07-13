import { supabase } from './supabase'
import type { AccountVerificationStatus, AdminPlatformAccount, Platform } from '../types/domain'

interface AdminPlatformAccountRow {
  id: number | string
  profile_id: string
  full_name: string | null
  major: string | null
  email: string | null
  platform: Platform
  external_id: string
  status: AccountVerificationStatus
  verified_at: string | null
  verification_error_code: string | null
  verification_error_message: string | null
  updated_at: string
}

export function mapAdminPlatformAccount(row: AdminPlatformAccountRow): AdminPlatformAccount {
  return {
    id: Number(row.id),
    profileId: row.profile_id,
    memberName: row.full_name ?? '未填写姓名',
    major: row.major ?? '未填写专业',
    email: row.email ?? '--',
    platform: row.platform,
    externalId: row.external_id,
    status: row.status,
    verifiedAt: row.verified_at,
    verificationErrorCode: row.verification_error_code,
    verificationErrorMessage: row.verification_error_message,
    updatedAt: row.updated_at,
  }
}

export async function fetchAdminPlatformAccounts(): Promise<AdminPlatformAccount[]> {
  if (!supabase) return []

  const { data, error } = await supabase.rpc('admin_list_platform_accounts')
  if (error) throw new Error(`平台账号列表读取失败：${error.message}`)

  return ((data ?? []) as AdminPlatformAccountRow[]).map(mapAdminPlatformAccount)
}

export async function setAdminPlatformAccountStatus(
  accountId: number,
  status: AccountVerificationStatus,
  errorMessage: string | null,
  expectedUpdatedAt: string,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.rpc('admin_set_platform_account_status', {
    target_account_id: accountId,
    next_status: status,
    error_message: errorMessage ?? '',
    expected_updated_at: expectedUpdatedAt,
  })

  if (error) throw new Error(`平台账号审核失败：${error.message}`)
}
