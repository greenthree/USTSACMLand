import { supabase } from './supabase'
import type { ReviewMember, ReviewStatus } from '../types/domain'

interface AdminReviewMemberRow {
  id: string
  email: string | null
  full_name: string | null
  major: string | null
  grade: string | null
  qq: string | null
  review_status: ReviewStatus
  review_note: string | null
  review_requested_at: string
  updated_at: string
  platform_count: number
}

export function mapAdminReviewMember(row: AdminReviewMemberRow): ReviewMember {
  return {
    id: row.id,
    name: row.full_name ?? '未填写姓名',
    major: row.major ?? '未填写专业',
    grade: row.grade ?? '未填写年级',
    qq: row.qq ?? '--',
    email: row.email ?? '--',
    submittedAt: row.review_requested_at,
    updatedAt: row.updated_at,
    reviewStatus: row.review_status,
    reviewNote: row.review_note,
    platformCount: Number(row.platform_count),
  }
}

export async function fetchAdminReviewMembers(): Promise<ReviewMember[]> {
  if (!supabase) return []

  const { data, error } = await supabase.rpc('admin_list_review_members')
  if (error) throw new Error(`成员列表读取失败：${error.message}`)

  return ((data ?? []) as AdminReviewMemberRow[]).map(mapAdminReviewMember)
}

export async function setAdminMemberReviewStatus(
  memberId: string,
  reviewStatus: ReviewStatus,
  expectedUpdatedAt: string,
  note: string | null = null,
): Promise<string> {
  if (!supabase) return expectedUpdatedAt

  const { data, error } = await supabase.rpc('admin_set_member_review_status', {
    target_profile_id: memberId,
    next_status: reviewStatus,
    expected_updated_at: expectedUpdatedAt,
    note: note ?? undefined,
  })

  if (error) throw new Error(`审核操作失败：${error.message}`)
  return data as string
}
