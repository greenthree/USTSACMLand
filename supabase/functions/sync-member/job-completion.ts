import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdapterErrorCode } from '../_shared/adapters/index.ts'

export interface SyncJobCompletion {
  transitioned: boolean
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  retryAt: string | null
  transitionedAt: string | null
}

interface SyncJobCompletionRow {
  transitioned: boolean
  job_status: SyncJobCompletion['status']
  retry_at: string | null
  transitioned_at: string | null
}

export async function completeSyncJobAttempt(
  client: SupabaseClient,
  input: {
    jobId: number
    attempt: number
    succeeded: boolean
    retryable?: boolean
    errorCode?: AdapterErrorCode | null
    errorMessage?: string | null
  },
): Promise<SyncJobCompletion> {
  const { data, error } = await client.rpc('complete_sync_job_attempt', {
    target_job_id: input.jobId,
    expected_attempt: input.attempt,
    attempt_succeeded: input.succeeded,
    failure_retryable: input.retryable ?? false,
    failure_code: input.errorCode ?? null,
    failure_message: input.errorMessage?.slice(0, 4_000) ?? null,
  })
  if (error) {
    throw new Error(`Could not atomically finish synchronization job: ${error.message}`)
  }

  const row = (data as SyncJobCompletionRow[] | null)?.[0]
  if (!row) throw new Error('Synchronization job completion returned no result')
  return {
    transitioned: row.transitioned,
    status: row.job_status,
    retryAt: row.retry_at,
    transitionedAt: row.transitioned_at,
  }
}
