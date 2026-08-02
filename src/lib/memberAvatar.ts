import { supabase } from './supabase'

interface SyncAvatarResponse {
  avatarAvailable?: boolean
  updated?: boolean
  error?: { message?: string }
}

export async function syncMemberAvatar(memberId?: string): Promise<void> {
  if (!supabase) return
  const { data, error } = await supabase.functions.invoke<SyncAvatarResponse>('sync-avatar', {
    body: memberId ? { memberId } : {},
  })
  if (error) throw new Error(`头像同步失败：${error.message}`)
  if (data?.error?.message) throw new Error(`头像同步失败：${data.error.message}`)
  if (data?.updated !== true) throw new Error('头像同步失败：服务未确认更新')
}
