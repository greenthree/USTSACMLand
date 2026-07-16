import type { SupabaseClient } from '@supabase/supabase-js'

interface AdminRateLimitRule {
  actionKey: string
  maxRequests: number
  windowSeconds: number
}

interface PostgrestErrorLike {
  message?: string
  details?: string | null
}

export class AdminRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many administrative requests')
    this.name = 'AdminRateLimitError'
  }
}

function retryAfterSeconds(error: PostgrestErrorLike): number {
  if (!error.details) return 60
  try {
    const detail = JSON.parse(error.details) as {
      retry_after_seconds?: unknown
    }
    const seconds = Number(detail.retry_after_seconds)
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
  } catch {
    return 60
  }
}

export async function consumeAdminRateLimit(
  client: SupabaseClient,
  actorId: string,
  rule: AdminRateLimitRule,
): Promise<void> {
  const { error } = await client.rpc('consume_admin_rate_limit', {
    rate_actor_id: actorId,
    rate_action_key: rule.actionKey,
    rate_max_requests: rule.maxRequests,
    rate_window_seconds: rule.windowSeconds,
  })
  if (!error) return
  if (error.message.includes('admin_rate_limited')) {
    throw new AdminRateLimitError(retryAfterSeconds(error))
  }
  throw new Error(`Could not apply administrator rate limit: ${error.message}`)
}
