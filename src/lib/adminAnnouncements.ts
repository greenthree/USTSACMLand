import { supabase } from './supabase'
import { adminRpcError } from './adminRateLimit'
import type { AdminAnnouncement, AdminAnnouncementInput } from '../types/domain'

interface RpcResponse {
  data: unknown
  error: { message: string; code?: string } | null
}

type UntypedRpc = (functionName: string, args: Record<string, unknown>) => PromiseLike<RpcResponse>

interface AdminAnnouncementRow {
  announcement_id: number | string
  title: string
  body: string
  status: AdminAnnouncement['status']
  published_at: string | null
  expires_at: string | null
  created_by: string | null
  created_by_label: string | null
  updated_by: string | null
  updated_by_label: string | null
  created_at: string
  updated_at: string
}

function mapAnnouncement(row: AdminAnnouncementRow): AdminAnnouncement {
  return {
    id: Number(row.announcement_id),
    title: row.title,
    body: row.body,
    status: row.status,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdByLabel: row.created_by_label?.trim() || '系统',
    updatedBy: row.updated_by,
    updatedByLabel: row.updated_by_label?.trim() || '系统',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchAdminAnnouncements(
  rowLimit = 50,
  beforeAnnouncementId: number | null = null,
): Promise<AdminAnnouncement[]> {
  if (!supabase) return []

  const { data, error } = await supabase.rpc('admin_list_announcements', {
    row_limit: rowLimit,
    before_announcement_id: beforeAnnouncementId ?? undefined,
  })
  if (error) throw new Error(`公告列表读取失败：${error.message}`)
  return ((data ?? []) as AdminAnnouncementRow[]).map(mapAnnouncement)
}

export async function saveAdminAnnouncement(
  input: AdminAnnouncementInput,
): Promise<{ id: number; updatedAt: string }> {
  if (!supabase) {
    return { id: input.id ?? Date.now(), updatedAt: new Date().toISOString() }
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc('admin_upsert_announcement', {
    target_announcement_id: input.id,
    announcement_title: input.title,
    announcement_body: input.body,
    announcement_status: input.status,
    announcement_published_at: input.publishedAt,
    announcement_expires_at: input.expiresAt,
    expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) throw adminRpcError('公告保存失败', error)
  const row = Array.isArray(data)
    ? (data[0] as { announcement_id: number | string; announcement_updated_at: string } | undefined)
    : undefined
  if (!row) throw new Error('公告保存失败：服务端未返回公告版本。')
  return { id: Number(row.announcement_id), updatedAt: row.announcement_updated_at }
}

export async function deleteAdminAnnouncement(
  id: number,
  expectedUpdatedAt: string,
): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.rpc('admin_delete_announcement', {
    target_announcement_id: id,
    expected_updated_at: expectedUpdatedAt,
  })
  if (error) throw adminRpcError('公告删除失败', error)
  if (data !== true) throw new Error('公告删除失败：服务端未确认删除。')
}
