import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdapterResult } from '../_shared/adapters/index.ts'
import { buildPlatformPersistenceState, persistNonLuoguResult } from './persistence.ts'

const successfulResult: AdapterResult = {
  ok: true,
  platform: 'xcpc_elo',
  accountId: 'xcpc_1234567890abcdef',
  metrics: {
    currentRating: 1723.5,
    maxRating: 1801.25,
    solvedCount: null,
  },
  fetchedAt: '2026-07-16T10:01:00.000Z',
  sourceUpdatedAt: '2026-07-16T10:00:00.000Z',
  sourceVersion: 'xcpc-elo:test-v1',
}

const failedResult: AdapterResult = {
  ok: false,
  platform: 'atcoder',
  accountId: 'member',
  error: {
    code: 'rate_limited',
    message: 'AtCoder temporarily limited the request.',
    retryable: true,
    details: { status: 429 },
  },
  fetchedAt: '2026-07-16T11:00:00.000Z',
}

function clientWithRpcResult(result: { error: null | { message: string } }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return Promise.resolve(result)
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

Deno.test('successful persistence state preserves decimal XCPC ELO ratings', () => {
  deepStrictEqual(
    buildPlatformPersistenceState(
      'xcpc_elo',
      undefined,
      successfulResult,
      '2026-07-16T10:01:00.000Z',
    ),
    {
      currentRating: 1723.5,
      maxRating: 1801.25,
      solvedCount: null,
      status: 'fresh',
      sourceObservedAt: '2026-07-16T10:00:00.000Z',
      lastSuccessAt: '2026-07-16T10:01:00.000Z',
      staleAfter: '2026-07-22T00:00:00.000Z',
      sourceVersion: 'xcpc-elo:test-v1',
    },
  )
})

Deno.test('failed persistence state retains the last successful values and freshness', () => {
  deepStrictEqual(
    buildPlatformPersistenceState(
      'atcoder',
      {
        currentRating: 1500,
        maxRating: 1600,
        solvedCount: 123,
        sourceObservedAt: '2026-07-16T09:59:00.000Z',
        lastSuccessAt: '2026-07-16T10:00:00.000Z',
        sourceVersion: 'atcoder:test-v1',
      },
      failedResult,
      '2026-07-16T11:00:00.000Z',
    ),
    {
      currentRating: 1500,
      maxRating: 1600,
      solvedCount: 123,
      status: 'fresh',
      sourceObservedAt: '2026-07-16T09:59:00.000Z',
      lastSuccessAt: '2026-07-16T10:00:00.000Z',
      staleAfter: '2026-07-16T13:00:00.000Z',
      sourceVersion: 'atcoder:test-v1',
    },
  )
})

Deno.test('failed persistence state without history remains unavailable instead of zero', () => {
  deepStrictEqual(
    buildPlatformPersistenceState('atcoder', undefined, failedResult, '2026-07-16T11:00:00.000Z'),
    {
      currentRating: null,
      maxRating: null,
      solvedCount: null,
      status: 'unavailable',
      sourceObservedAt: null,
      lastSuccessAt: null,
      staleAfter: null,
      sourceVersion: null,
    },
  )
})

Deno.test(
  'non-Luogu persistence sends one atomic RPC with source and decimal metrics',
  async () => {
    const { client, calls } = clientWithRpcResult({ error: null })
    const state = buildPlatformPersistenceState(
      'xcpc_elo',
      undefined,
      successfulResult,
      '2026-07-16T10:01:00.000Z',
    )

    await persistNonLuoguResult(
      client,
      501,
      601,
      {
        id: 701,
        platform: 'xcpc_elo',
        externalId: 'xcpc_1234567890abcdef',
      },
      successfulResult,
      state,
      '2026-07-16T10:00:59.000Z',
      '2026-07-16T10:01:00.000Z',
    )

    strictEqual(calls.length, 1)
    strictEqual(calls[0].name, 'commit_platform_sync_result')
    deepStrictEqual(calls[0].args, {
      target_platform_account_id: 701,
      expected_external_id: 'xcpc_1234567890abcdef',
      target_job_id: 501,
      target_run_id: 601,
      sync_succeeded: true,
      stat_current_rating: 1723.5,
      stat_max_rating: 1801.25,
      stat_solved_count: null,
      stat_status: 'fresh',
      stat_source_observed_at: '2026-07-16T10:00:00.000Z',
      stat_fetched_at: '2026-07-16T10:01:00.000Z',
      stat_last_success_at: '2026-07-16T10:01:00.000Z',
      stat_stale_after: '2026-07-22T00:00:00.000Z',
      stat_error_code: null,
      stat_error_message: null,
      stat_source_version: 'xcpc-elo:test-v1',
      run_finished_at: '2026-07-16T10:01:00.000Z',
      run_duration_ms: 1000,
      run_metrics: {
        currentRating: 1723.5,
        maxRating: 1801.25,
        solvedCount: null,
      },
    })
  },
)

Deno.test('atomic RPC errors are surfaced to the run failure fallback', async () => {
  const { client } = clientWithRpcResult({ error: { message: 'run is no longer writable' } })
  const state = buildPlatformPersistenceState(
    'atcoder',
    undefined,
    failedResult,
    '2026-07-16T11:00:00.000Z',
  )

  await rejects(
    () =>
      persistNonLuoguResult(
        client,
        502,
        602,
        { id: 702, platform: 'atcoder', externalId: 'member' },
        failedResult,
        state,
        '2026-07-16T10:59:59.000Z',
        '2026-07-16T11:00:00.000Z',
      ),
    /Could not atomically commit atcoder sync result: run is no longer writable/,
  )
})

Deno.test('Luogu cannot accidentally use the generic atomic RPC', async () => {
  const { client, calls } = clientWithRpcResult({ error: null })
  await rejects(
    () =>
      persistNonLuoguResult(
        client,
        503,
        603,
        { id: 703, platform: 'luogu', externalId: '409073' },
        failedResult,
        buildPlatformPersistenceState('luogu', undefined, failedResult, '2026-07-16T11:00:00.000Z'),
        '2026-07-16T10:59:59.000Z',
        '2026-07-16T11:00:00.000Z',
      ),
    /Luogu synchronization must use its atomic persistence RPC/,
  )
  strictEqual(calls.length, 0)
})
