import { deepStrictEqual, rejects } from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completeSyncJobAttempt } from './job-completion.ts'

function clientWithRpcResult(result: { data: unknown; error: null | { message: string } }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return Promise.resolve(result)
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

Deno.test(
  'job completion delegates the attempt guard and failure metadata to one RPC',
  async () => {
    const { client, calls } = clientWithRpcResult({
      data: [
        {
          transitioned: true,
          job_status: 'queued',
          retry_at: '2026-07-17T02:02:00.000Z',
          transitioned_at: '2026-07-17T01:58:00.000Z',
        },
      ],
      error: null,
    })

    const result = await completeSyncJobAttempt(client, {
      jobId: 501,
      attempt: 2,
      succeeded: false,
      retryable: true,
      errorCode: 'rate_limited',
      errorMessage: 'temporary upstream limit',
    })

    deepStrictEqual(calls, [
      {
        name: 'complete_sync_job_attempt',
        args: {
          target_job_id: 501,
          expected_attempt: 2,
          attempt_succeeded: false,
          failure_retryable: true,
          failure_code: 'rate_limited',
          failure_message: 'temporary upstream limit',
        },
      },
    ])
    deepStrictEqual(result, {
      transitioned: true,
      status: 'queued',
      retryAt: '2026-07-17T02:02:00.000Z',
      transitionedAt: '2026-07-17T01:58:00.000Z',
    })
  },
)

Deno.test('job completion surfaces RPC failures and missing result rows', async () => {
  const failed = clientWithRpcResult({ data: null, error: { message: 'attempt changed' } })
  await rejects(
    () =>
      completeSyncJobAttempt(failed.client, {
        jobId: 502,
        attempt: 1,
        succeeded: true,
      }),
    /Could not atomically finish synchronization job: attempt changed/,
  )

  const empty = clientWithRpcResult({ data: [], error: null })
  await rejects(
    () =>
      completeSyncJobAttempt(empty.client, {
        jobId: 503,
        attempt: 1,
        succeeded: true,
      }),
    /returned no result/,
  )
})
