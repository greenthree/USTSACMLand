import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AdminRateLimitError, consumeAdminRateLimit } from './admin-rate-limit.ts'

function clientWithResult(result: { error: null | { message: string; details?: string } }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return Promise.resolve(result)
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

Deno.test('consumeAdminRateLimit sends the authenticated actor and fixed rule', async () => {
  const { client, calls } = clientWithResult({ error: null })

  await consumeAdminRateLimit(client, '00000000-0000-0000-0000-000000000001', {
    actionKey: 'admin.sync.scoped',
    maxRequests: 12,
    windowSeconds: 60,
  })

  deepStrictEqual(calls, [
    {
      name: 'consume_admin_rate_limit',
      args: {
        rate_actor_id: '00000000-0000-0000-0000-000000000001',
        rate_action_key: 'admin.sync.scoped',
        rate_max_requests: 12,
        rate_window_seconds: 60,
      },
    },
  ])
})

Deno.test('consumeAdminRateLimit exposes a bounded retry delay', async () => {
  const { client } = clientWithResult({
    error: {
      message: 'admin_rate_limited',
      details: '{"action":"admin.sync.scoped","retry_after_seconds":17}',
    },
  })

  let caught: unknown
  try {
    await consumeAdminRateLimit(client, '00000000-0000-0000-0000-000000000001', {
      actionKey: 'admin.sync.scoped',
      maxRequests: 12,
      windowSeconds: 60,
    })
  } catch (error) {
    caught = error
  }
  ok(caught instanceof AdminRateLimitError)
  strictEqual(caught.retryAfterSeconds, 17)
})

Deno.test('consumeAdminRateLimit does not hide infrastructure failures', async () => {
  const { client } = clientWithResult({
    error: { message: 'database unavailable' },
  })

  await rejects(
    () =>
      consumeAdminRateLimit(client, '00000000-0000-0000-0000-000000000001', {
        actionKey: 'admin.sync.scoped',
        maxRequests: 12,
        windowSeconds: 60,
      }),
    Error,
    'Could not apply administrator rate limit: database unavailable',
  )
})
