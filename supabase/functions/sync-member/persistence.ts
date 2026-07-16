import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdapterResult, PlatformId } from '../_shared/adapters/index.ts'
import { freshnessDeadline, retainedFreshness } from '../_shared/freshness.ts'

export interface PersistedAccountIdentity {
  id: number
  platform: PlatformId
  externalId: string
}

export interface ExistingPlatformStat {
  currentRating: number | null
  maxRating: number | null
  solvedCount: number | null
  sourceObservedAt: string | null
  lastSuccessAt: string | null
  sourceVersion: string | null
}

export interface PlatformPersistenceState {
  currentRating: number | null
  maxRating: number | null
  solvedCount: number | null
  status: 'fresh' | 'stale' | 'unavailable'
  sourceObservedAt: string | null
  lastSuccessAt: string | null
  staleAfter: string | null
  sourceVersion: string | null
}

export function buildPlatformPersistenceState(
  platform: PlatformId,
  existing: ExistingPlatformStat | undefined,
  result: AdapterResult,
  finishedAt: string,
): PlatformPersistenceState {
  if (result.ok) {
    return {
      currentRating: result.metrics.currentRating,
      maxRating: result.metrics.maxRating,
      solvedCount: result.metrics.solvedCount,
      status: 'fresh',
      sourceObservedAt: result.sourceUpdatedAt,
      lastSuccessAt: result.fetchedAt,
      staleAfter: freshnessDeadline(platform, result.fetchedAt),
      sourceVersion: result.sourceVersion,
    }
  }

  const retained = retainedFreshness(
    platform,
    existing?.lastSuccessAt ?? null,
    Date.parse(finishedAt),
  )
  return {
    currentRating: existing?.currentRating ?? null,
    maxRating: existing?.maxRating ?? null,
    solvedCount: existing?.solvedCount ?? null,
    status: retained.status,
    sourceObservedAt: existing?.sourceObservedAt ?? null,
    lastSuccessAt: existing?.lastSuccessAt ?? null,
    staleAfter: retained.staleAfter,
    sourceVersion: existing?.sourceVersion ?? null,
  }
}

export async function persistNonLuoguResult(
  client: SupabaseClient,
  jobId: number,
  runId: number,
  account: PersistedAccountIdentity,
  result: AdapterResult,
  state: PlatformPersistenceState,
  startedAt: string,
  finishedAt: string,
): Promise<void> {
  if (account.platform === 'luogu') {
    throw new Error('Luogu synchronization must use its atomic persistence RPC')
  }
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
  const errorCode = result.ok ? null : result.error.code
  const errorMessage = result.ok ? null : result.error.message.slice(0, 4_000)

  const { error } = await client.rpc('commit_platform_sync_result', {
    target_platform_account_id: account.id,
    expected_external_id: account.externalId,
    target_job_id: jobId,
    target_run_id: runId,
    sync_succeeded: result.ok,
    stat_current_rating: state.currentRating,
    stat_max_rating: state.maxRating,
    stat_solved_count: state.solvedCount,
    stat_status: state.status,
    stat_source_observed_at: state.sourceObservedAt,
    stat_fetched_at: result.fetchedAt,
    stat_last_success_at: state.lastSuccessAt,
    stat_stale_after: state.staleAfter,
    stat_error_code: errorCode,
    stat_error_message: errorMessage,
    stat_source_version: state.sourceVersion,
    run_finished_at: finishedAt,
    run_duration_ms: durationMs,
    run_metrics: result.ok
      ? result.metrics
      : result.error.details
        ? { diagnostics: result.error.details }
        : null,
  })
  if (error) {
    throw new Error(`Could not atomically commit ${account.platform} sync result: ${error.message}`)
  }
}
