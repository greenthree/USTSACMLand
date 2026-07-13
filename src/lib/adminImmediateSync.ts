import type { Platform, SyncTriggerType } from '../types/domain'
import { supabase } from './supabase'

type ImmediateSyncTrigger = Extract<SyncTriggerType, 'registration' | 'account_changed'>

interface ImmediateSyncRequest {
  memberId: string
  platforms?: Platform[]
  triggerType: ImmediateSyncTrigger
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function responseFailureMessage(value: unknown): string | null {
  const response = recordValue(value)
  if (response.status !== 'failed') return null

  if (Array.isArray(response.results)) {
    for (const result of response.results) {
      const error = recordValue(recordValue(result).error)
      if (typeof error.message === 'string' && error.message.trim()) return error.message
    }
  }
  return '同步服务返回失败状态'
}

export async function triggerAdminImmediateSync(request: ImmediateSyncRequest): Promise<void> {
  if (!supabase) return

  const { data, error } = await supabase.functions.invoke('sync-member', {
    body: {
      memberId: request.memberId,
      ...(request.platforms ? { platforms: request.platforms } : {}),
      triggerType: request.triggerType,
    },
  })
  if (error) throw new Error(error.message)

  const failureMessage = responseFailureMessage(data)
  if (failureMessage) throw new Error(failureMessage)
}
