import { supabase } from './supabase'
import type { AdminMember, ReviewStatus } from '../types/domain'

interface AdminMemberRow {
  id: string
  email: string | null
  full_name: string | null
  major: string | null
  grade: string | null
  qq: string | null
  review_status: Extract<ReviewStatus, 'approved' | 'suspended'>
  suspension_note: string | null
  is_public: boolean
  created_at: string
  updated_at: string
  platform_count: number | string
  verified_platform_count: number | string
}

export function mapAdminMember(row: AdminMemberRow): AdminMember {
  return {
    id: row.id,
    name: row.full_name ?? '未填写姓名',
    email: row.email ?? '--',
    qq: row.qq ?? '--',
    major: row.major ?? '未填写专业',
    grade: row.grade ?? '未填写年级',
    status: row.review_status === 'suspended' ? 'suspended' : 'active',
    suspensionNote: row.suspension_note,
    isPublic: row.is_public,
    joinedAt: row.created_at,
    updatedAt: row.updated_at,
    platformCount: Number(row.platform_count),
    verifiedPlatformCount: Number(row.verified_platform_count),
  }
}

export async function fetchAdminMembers(): Promise<AdminMember[]> {
  if (!supabase) return []

  const { data, error } = await supabase.rpc('admin_list_members')
  if (error) throw new Error(`成员列表读取失败：${error.message}`)

  return ((data ?? []) as AdminMemberRow[]).map(mapAdminMember)
}

export async function setAdminMemberSuspension(
  memberId: string,
  suspended: boolean,
  expectedUpdatedAt: string,
  note: string | null = null,
): Promise<string> {
  if (!supabase) return new Date().toISOString()

  const { data, error } = await supabase.rpc('admin_set_member_suspension', {
    target_profile_id: memberId,
    suspended,
    expected_updated_at: expectedUpdatedAt,
    note: note ?? undefined,
  })

  if (error) throw new Error(`成员状态更新失败：${error.message}`)
  return data as string
}
