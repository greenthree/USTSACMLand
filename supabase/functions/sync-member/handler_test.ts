// deno-lint-ignore-file no-explicit-any require-await
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdapterResult } from '../_shared/adapters/index.ts'
import {
  createSyncMemberHandler,
  type SyncMemberAdapterContext,
  type SyncMemberHandlerDependencies,
} from './handler.ts'

const memberId = '11111111-1111-4111-8111-111111111111'
const serviceRoleKey = 'test-service-role-key'
const now = new Date('2026-07-23T08:00:00.000Z')

interface FakeClientState {
  inserts: Array<{ table: string; value: unknown }>
  updates: Array<{ table: string; value: unknown }>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
}

function fakeServiceClient(): { client: SupabaseClient; state: FakeClientState } {
  const state: FakeClientState = { inserts: [], updates: [], rpcCalls: [] }

  function queryFor(table: string): any {
    let operation = 'select'
    const result = () => {
      if (table === 'profiles') {
        return {
          data: { full_name: '测试成员', review_status: 'approved' },
          error: null,
        }
      }
      if (table === 'platform_accounts') {
        return {
          data: [
            {
              id: 71,
              profile_id: memberId,
              platform: 'codeforces',
              external_id: 'tourist',
              status: 'verified',
              updated_at: '2026-07-22T00:00:00.000Z',
            },
          ],
          error: null,
        }
      }
      if (table === 'sync_jobs' && operation === 'insert') {
        return {
          data: { id: 501, created_at: '2026-07-23T08:00:00.000Z' },
          error: null,
        }
      }
      if (table === 'sync_jobs' && operation === 'update') {
        return { data: { id: 501 }, error: null }
      }
      if (table === 'platform_stats') return { data: [], error: null }
      if (table === 'sync_runs' && operation === 'insert') {
        return { data: { id: 601 }, error: null }
      }
      return { data: null, error: null }
    }

    const query: any = {
      select() {
        return query
      },
      eq() {
        return query
      },
      in() {
        return query
      },
      insert(value: unknown) {
        operation = 'insert'
        state.inserts.push({ table, value })
        return query
      },
      update(value: unknown) {
        operation = 'update'
        state.updates.push({ table, value })
        return query
      },
      single() {
        return Promise.resolve(result())
      },
      maybeSingle() {
        return Promise.resolve(result())
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject)
      },
    }
    return query
  }

  const client = {
    auth: {
      async getUser() {
        throw new Error('service role requests must not call Auth')
      },
    },
    from: queryFor,
    async rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, args })
      if (name === 'complete_sync_job_attempt') {
        const succeeded = args.attempt_succeeded === true
        return {
          data: [
            {
              transitioned: true,
              job_status: succeeded ? 'succeeded' : 'failed',
              retry_at: null,
              transitioned_at: '2026-07-23T08:00:00.000Z',
            },
          ],
          error: null,
        }
      }
      return { data: null, error: null }
    },
  } as unknown as SupabaseClient

  return { client, state }
}

function syncRequest(): Request {
  return new Request('https://project.supabase.co/functions/v1/sync-member', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      memberId,
      platforms: ['codeforces'],
      triggerType: 'scheduled',
    }),
  })
}

Deno.test('sync member rejects unsupported methods before creating a client', async () => {
  let clientCreations = 0
  const handler = createSyncMemberHandler({
    allowedOrigins: '*',
    createClient() {
      clientCreations += 1
      throw new Error('must not run')
    },
    async resolveAdapter() {
      return null
    },
    now: () => now,
    async notifySyncFailure() {},
    async notifyRuntimeError() {},
  })

  const response = await handler(
    new Request('https://project.supabase.co/functions/v1/sync-member', { method: 'GET' }),
  )
  strictEqual(response.status, 405)
  strictEqual(clientCreations, 0)
})

Deno.test(
  'sync member runs an injected adapter through production persistence and job completion',
  async () => {
    const { client, state } = fakeServiceClient()
    const adapterContexts: SyncMemberAdapterContext[] = []
    const notifications: string[] = []
    const result: AdapterResult = {
      ok: true,
      platform: 'codeforces',
      accountId: 'tourist',
      metrics: { currentRating: 3900, maxRating: 4000, solvedCount: 3100 },
      fetchedAt: '2026-07-23T07:59:59.000Z',
      sourceUpdatedAt: '2026-07-23T07:30:00.000Z',
      sourceVersion: 'codeforces:test',
    }
    const dependencies: SyncMemberHandlerDependencies = {
      allowedOrigins: '*',
      createClient: () => ({ client, serviceRoleKey }),
      async resolveAdapter(context) {
        adapterContexts.push(context)
        return {
          platform: 'codeforces',
          async sync(externalId) {
            strictEqual(externalId, 'tourist')
            return result
          },
        }
      },
      now: () => now,
      async notifySyncFailure() {
        notifications.push('sync')
      },
      async notifyRuntimeError() {
        notifications.push('runtime')
      },
    }

    const response = await createSyncMemberHandler(dependencies)(syncRequest())
    strictEqual(response.status, 200)
    const body = (await response.json()) as Record<string, unknown>
    deepStrictEqual(body, {
      jobId: 501,
      memberId,
      status: 'succeeded',
      attempt: 1,
      maxAttempts: 2,
      retryAt: null,
      results: [{ runId: 601, ...result }],
    })

    strictEqual(adapterContexts.length, 1)
    deepStrictEqual(adapterContexts[0].account, {
      id: 71,
      profile_id: memberId,
      platform: 'codeforces',
      external_id: 'tourist',
      status: 'verified',
      updated_at: '2026-07-22T00:00:00.000Z',
    })
    strictEqual(adapterContexts[0].client, client)
    strictEqual(adapterContexts[0].jobId, 501)
    strictEqual(adapterContexts[0].attempt, 1)
    strictEqual(adapterContexts[0].runId, 601)
    deepStrictEqual(notifications, [])

    const createdJob = state.inserts.find(({ table }) => table === 'sync_jobs')
    deepStrictEqual(createdJob?.value, {
      scope: 'account',
      profile_id: memberId,
      platform: 'codeforces',
      dedupe_key: `member:${memberId}:platform:codeforces`,
      payload: { platforms: ['codeforces'] },
      status: 'queued',
      trigger_type: 'scheduled',
      requested_by: null,
      attempt_count: 0,
      max_attempts: 2,
      scheduled_for: '2026-07-23T08:01:00.000Z',
    })
    deepStrictEqual(
      state.rpcCalls.map(({ name }) => name),
      ['commit_platform_sync_result', 'complete_sync_job_attempt'],
    )
  },
)

Deno.test(
  'sync member completes and reports an unexpected adapter resolution failure',
  async () => {
    const { client, state } = fakeServiceClient()
    const notifications: string[] = []
    const response = await createSyncMemberHandler({
      allowedOrigins: '*',
      createClient: () => ({ client, serviceRoleKey }),
      async resolveAdapter() {
        return null
      },
      now: () => now,
      async notifySyncFailure(alert) {
        strictEqual(alert.jobId, 501)
        deepStrictEqual(alert.failures, [{ platform: 'codeforces', code: 'unknown' }])
        notifications.push('sync')
      },
      async notifyRuntimeError(alert) {
        strictEqual(alert.surface, 'sync-member')
        notifications.push('runtime')
      },
    })(syncRequest())

    strictEqual(response.status, 500)
    deepStrictEqual(await response.json(), { error: 'codeforces adapter is unavailable' })
    deepStrictEqual(notifications, ['runtime', 'sync'])
    deepStrictEqual(
      state.rpcCalls.map(({ name }) => name),
      ['complete_sync_job_attempt'],
    )
    strictEqual(
      state.updates.some(
        ({ table, value }) =>
          table === 'sync_runs' &&
          (value as { status?: string }).status === 'failed' &&
          (value as { error_code?: string }).error_code === 'unknown',
      ),
      true,
    )
  },
)
