import { createClient } from '@supabase/supabase-js'
import { deepStrictEqual, equal, match, ok } from 'node:assert/strict'
import {
  failure,
  success,
  type PlatformAdapter,
  type PlatformId,
} from '../_shared/adapters/index.ts'
import {
  summarizePlatformSyncResults,
  type PlatformMemberSyncResult,
} from '../_shared/sync-result.ts'
import { dispatchWithPlatformLimits, type SyncDispatchTarget } from '../sync-stats/dispatch.ts'
import { createSyncMemberHandler, type SyncMemberAdapterContext } from './handler.ts'

interface FixtureAccount {
  id: number
  platform: PlatformId
  external_id: string
  status: string
}

interface FixtureJob {
  id: number
  platform: PlatformId
  status: string
  attempt_count: number
  max_attempts: number
  dedupe_key: string
}

function requiredEnv(name: 'ANON_KEY' | 'API_URL' | 'SERVICE_ROLE_KEY'): string {
  const value = Deno.env.get(name)
  if (!value)
    throw new Error(`Missing ${name}; run this check through npm run check:sync-platform-outage.`)
  return value
}

function requiredFixtureEnv(
  name:
    | 'SYNC_OUTAGE_PHASE'
    | 'SYNC_OUTAGE_PROFILE_ID'
    | 'SYNC_OUTAGE_SUFFIX'
    | 'SYNC_OUTAGE_OBSERVED_AT',
): string {
  const value = Deno.env.get(name)
  if (!value)
    throw new Error(`Missing ${name}; run this check through npm run check:sync-platform-outage.`)
  return value
}

function isoTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

async function dataOrThrow<T extends { data: unknown; error: { message: string } | null }>(
  operation: string,
  request: PromiseLike<T>,
): Promise<NonNullable<T['data']>> {
  const { data, error } = await request
  if (error) throw new Error(`${operation}: ${error.message}`)
  if (data === null || data === undefined) throw new Error(`${operation}: no data returned`)
  return data as NonNullable<T['data']>
}

async function invokeMemberSync(
  handler: (request: Request) => Promise<Response>,
  serviceRoleKey: string,
  target: SyncDispatchTarget,
): Promise<PlatformMemberSyncResult> {
  const response = await handler(
    new Request('http://127.0.0.1:54321/functions/v1/sync-member', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        memberId: target.memberId,
        platforms: [target.platform],
        ...(target.jobId ? { jobId: target.jobId } : { triggerType: 'scheduled' }),
      }),
    }),
  )
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = { error: 'sync-member returned non-JSON output' }
  }
  return { memberId: target.memberId, platform: target.platform, status: response.status, body }
}

Deno.test({
  name: 'one platform outage preserves its data, retries once, and does not block another platform',
  ignore: Deno.env.get('SYNC_OUTAGE_PHASE') === undefined,
  async fn() {
    const apiUrl = requiredEnv('API_URL')
    const anonKey = requiredEnv('ANON_KEY')
    const serviceRoleKey = requiredEnv('SERVICE_ROLE_KEY')
    const serviceClient = createClient(apiUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const publicClient = createClient(apiUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const phase = requiredFixtureEnv('SYNC_OUTAGE_PHASE')
    const profileId = requiredFixtureEnv('SYNC_OUTAGE_PROFILE_ID')
    const observedAt = requiredFixtureEnv('SYNC_OUTAGE_OBSERVED_AT')
    if (phase !== 'initial' && phase !== 'retry')
      throw new Error(`Unsupported outage phase: ${phase}`)

    const accounts = await dataOrThrow(
      'Could not load outage fixture platform accounts',
      serviceClient
        .from('platform_accounts')
        .select('id, platform, external_id, status')
        .eq('profile_id', profileId)
        .in('platform', ['codeforces', 'atcoder'])
        .order('platform'),
    )
    equal(accounts.length, 2)

    const calls = new Map<PlatformId, number>()
    const resolveAdapter = ({ account }: SyncMemberAdapterContext): PlatformAdapter => ({
      platform: account.platform,
      sync(accountId) {
        calls.set(account.platform, (calls.get(account.platform) ?? 0) + 1)
        if (account.platform === 'codeforces') {
          return Promise.resolve(
            failure(
              'codeforces',
              accountId,
              'source_unavailable',
              'Synthetic Codeforces outage for the integration drill.',
              true,
            ),
          )
        }
        if (account.platform === 'atcoder') {
          return Promise.resolve(
            success(
              'atcoder',
              accountId,
              { currentRating: 1400, maxRating: 1500, solvedCount: 222 },
              {
                fetchedAt: new Date().toISOString(),
                sourceUpdatedAt: new Date(Date.now() - 1_000).toISOString(),
                sourceVersion: 'fixture-atcoder-success',
              },
            ),
          )
        }
        throw new Error(`No synthetic adapter is permitted for ${account.platform}.`)
      },
    })
    const handler = createSyncMemberHandler({
      allowedOrigins: '*',
      createClient: () => ({ client: serviceClient, serviceRoleKey }),
      resolveAdapter,
      now: () => new Date(),
      notifySyncFailure: async () => {},
      notifyRuntimeError: async () => {},
    })

    if (phase === 'initial') {
      const initialTargets: SyncDispatchTarget[] = [
        { memberId: profileId, platform: 'codeforces' },
        { memberId: profileId, platform: 'atcoder' },
      ]
      const firstRound = await dispatchWithPlatformLimits(
        initialTargets,
        (target) => invokeMemberSync(handler, serviceRoleKey, target),
        (target, error) => ({
          memberId: target.memberId,
          platform: target.platform,
          status: 599,
          body: { error: error instanceof Error ? error.message : 'unexpected dispatch error' },
        }),
      )
      deepStrictEqual(summarizePlatformSyncResults(firstRound), [
        { platform: 'codeforces', requested: 1, succeeded: 0, queued: 1, failed: 0 },
        { platform: 'atcoder', requested: 1, succeeded: 1, queued: 0, failed: 0 },
      ])

      const firstJobs = (await dataOrThrow(
        'Could not read first-round jobs',
        serviceClient
          .from('sync_jobs')
          .select('id, platform, status, attempt_count, max_attempts, dedupe_key')
          .eq('profile_id', profileId)
          .order('id'),
      )) as FixtureJob[]
      equal(firstJobs.length, 2)
      const failedJob = firstJobs.find((job) => job.platform === 'codeforces')
      const successfulJob = firstJobs.find((job) => job.platform === 'atcoder')
      ok(failedJob)
      ok(successfulJob)
      deepStrictEqual(
        {
          status: failedJob.status,
          attempt: failedJob.attempt_count,
          maxAttempts: failedJob.max_attempts,
        },
        { status: 'queued', attempt: 1, maxAttempts: 2 },
      )
      deepStrictEqual(
        {
          status: successfulJob.status,
          attempt: successfulJob.attempt_count,
          maxAttempts: successfulJob.max_attempts,
        },
        { status: 'succeeded', attempt: 1, maxAttempts: 2 },
      )
      match(failedJob.dedupe_key, new RegExp(`^member:${profileId}:platform:codeforces$`))
      match(successfulJob.dedupe_key, new RegExp(`^member:${profileId}:platform:atcoder$`))

      equal(calls.get('codeforces'), 1)
      equal(calls.get('atcoder'), 1)
      return
    }

    const firstJobs = (await dataOrThrow(
      'Could not load jobs before the retry phase',
      serviceClient
        .from('sync_jobs')
        .select('id, platform, status, attempt_count, max_attempts, dedupe_key')
        .eq('profile_id', profileId)
        .order('id'),
    )) as FixtureJob[]
    const failedJob = firstJobs.find((job) => job.platform === 'codeforces')
    ok(failedJob)
    const claimed = (await dataOrThrow(
      'Could not claim due retry',
      serviceClient.rpc('claim_due_sync_jobs', {
        batch_limit: 12,
        stale_timeout: '15 minutes',
      }),
    )) as Array<{
      job_id: number
      profile_id: string
      platform: PlatformId
      attempt_count: number
      max_attempts: number
    }>
    const retry = claimed.find((job) => job.job_id === failedJob.id)
    ok(retry)
    deepStrictEqual(
      { attempt: retry.attempt_count, maxAttempts: retry.max_attempts },
      { attempt: 2, maxAttempts: 2 },
    )

    const secondRound = await invokeMemberSync(handler, serviceRoleKey, {
      memberId: profileId,
      platform: 'codeforces',
      jobId: failedJob.id,
    })
    equal(secondRound.status, 207)
    deepStrictEqual(summarizePlatformSyncResults([secondRound]), [
      { platform: 'codeforces', requested: 1, succeeded: 0, queued: 0, failed: 1 },
    ])

    const thirdClaim = (await dataOrThrow(
      'Could not verify that no third retry is claimable',
      serviceClient.rpc('claim_due_sync_jobs', {
        batch_limit: 12,
        stale_timeout: '15 minutes',
      }),
    )) as Array<{ job_id: number; profile_id: string }>
    equal(
      thirdClaim.some((job) => job.profile_id === profileId),
      false,
    )
    equal(calls.get('codeforces'), 1)
    equal(calls.get('atcoder') ?? 0, 0)

    const finalJobs = (await dataOrThrow(
      'Could not read final jobs',
      serviceClient
        .from('sync_jobs')
        .select('id, platform, status, attempt_count, max_attempts, dedupe_key')
        .eq('profile_id', profileId)
        .order('id'),
    )) as FixtureJob[]
    deepStrictEqual(
      finalJobs.map((job) => [job.platform, job.status, job.attempt_count]),
      [
        ['codeforces', 'failed', 2],
        ['atcoder', 'succeeded', 1],
      ],
    )

    const runs = await dataOrThrow(
      'Could not read sync runs',
      serviceClient
        .from('sync_runs')
        .select('platform, attempt, status, error_code')
        .eq('profile_id', profileId)
        .order('id'),
    )
    deepStrictEqual(
      runs.map((run) => [run.platform, run.attempt, run.status, run.error_code]),
      [
        ['codeforces', 1, 'failed', 'source_unavailable'],
        ['atcoder', 1, 'succeeded', null],
        ['codeforces', 2, 'failed', 'source_unavailable'],
      ],
    )

    const stats = await dataOrThrow(
      'Could not read final platform statistics',
      serviceClient
        .from('platform_stats')
        .select(
          'platform, current_rating, max_rating, solved_count, last_success_at, source_observed_at, source_version, error_code',
        )
        .eq('profile_id', profileId)
        .order('platform'),
    )
    const codeforces = stats.find((stat) => stat.platform === 'codeforces')
    const atcoder = stats.find((stat) => stat.platform === 'atcoder')
    ok(codeforces)
    ok(atcoder)
    deepStrictEqual(
      {
        currentRating: Number(codeforces.current_rating),
        maxRating: Number(codeforces.max_rating),
        solvedCount: codeforces.solved_count,
        lastSuccessAt: isoTimestamp(codeforces.last_success_at),
        sourceObservedAt: isoTimestamp(codeforces.source_observed_at),
        sourceVersion: codeforces.source_version,
        errorCode: codeforces.error_code,
      },
      {
        currentRating: 1600,
        maxRating: 1800,
        solvedCount: 321,
        lastSuccessAt: isoTimestamp(observedAt),
        sourceObservedAt: isoTimestamp(observedAt),
        sourceVersion: 'fixture-codeforces-before-outage',
        errorCode: 'source_unavailable',
      },
    )
    deepStrictEqual(
      {
        currentRating: Number(atcoder.current_rating),
        maxRating: Number(atcoder.max_rating),
        solvedCount: atcoder.solved_count,
        sourceVersion: atcoder.source_version,
        errorCode: atcoder.error_code,
      },
      {
        currentRating: 1400,
        maxRating: 1500,
        solvedCount: 222,
        sourceVersion: 'fixture-atcoder-success',
        errorCode: null,
      },
    )

    const snapshots = await dataOrThrow(
      'Could not read the public synchronization snapshots',
      publicClient
        .from('public_stat_snapshots')
        .select('platform, source_observed_at, current_rating, solved_count')
        .eq('profile_id', profileId)
        .order('id'),
    )
    equal(snapshots.length, 3)
    equal(
      snapshots.filter(
        (snapshot) => snapshot.platform === 'codeforces' && snapshot.source_observed_at === null,
      ).length,
      2,
    )
    equal(
      snapshots.filter(
        (snapshot) => snapshot.platform === 'atcoder' && snapshot.source_observed_at !== null,
      ).length,
      1,
    )

    const publicStats = await dataOrThrow(
      'Could not read public statistics projection',
      publicClient
        .from('public_platform_stats')
        .select('platform, current_rating, solved_count, error_code')
        .eq('profile_id', profileId)
        .order('platform'),
    )
    deepStrictEqual(
      publicStats.map((stat) => [
        stat.platform,
        Number(stat.current_rating),
        stat.solved_count,
        stat.error_code,
      ]),
      [
        ['codeforces', 1600, 321, 'source_unavailable'],
        ['atcoder', 1400, 222, null],
      ],
    )
    const finalAccounts = await dataOrThrow(
      'Could not verify platform account identities',
      serviceClient
        .from('platform_accounts')
        .select('id, platform, external_id, status')
        .eq('profile_id', profileId)
        .in('platform', ['codeforces', 'atcoder'])
        .order('platform'),
    )
    deepStrictEqual(
      finalAccounts.map((account) => [account.platform, account.external_id, account.status]),
      (accounts as FixtureAccount[]).map((account) => [
        account.platform,
        account.external_id,
        'verified',
      ]),
    )
  },
})
