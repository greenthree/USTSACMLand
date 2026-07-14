import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  type AdapterResult,
  adapters,
  failure,
  PLATFORM_IDS,
  type PlatformId,
} from '../_shared/adapters/index.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { freshnessDeadline, retainedFreshness } from '../_shared/freshness.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import {
  canRequestSync,
  isRegistrationSyncWindowOpen,
  SYNC_TRIGGER_TYPES,
  type SyncTriggerType,
} from './access.ts'
import { buildSyncJobTarget } from './job.ts'

interface SyncRequest {
  memberId?: string
  platforms?: PlatformId[]
  triggerType?: SyncTriggerType
}

interface PlatformAccount {
  id: number
  profile_id: string
  platform: PlatformId
  external_id: string
  status: 'pending' | 'verified' | 'invalid' | 'disabled'
}

interface ExistingStat {
  profile_id: string
  platform: PlatformId
  current_rating: number | null
  max_rating: number | null
  solved_count: number | null
  source_observed_at: string | null
  last_success_at: string | null
  source_version: string | null
}

interface LuoguSyncStateRow {
  platform_account_id: number
  account_external_id: string
  state_version: number
  boundary_record_id: string | null
  boundary_submit_time: number | null
  total_records: number | null
  problem_ids: string[]
  last_full_sync_at: string
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApiError(401, 'Missing bearer token')
  return match[1]
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function selectedPlatforms(value: unknown): PlatformId[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, 'platforms must be a non-empty array')
  }
  const unique = [...new Set(value)]
  if (
    unique.some(
      (platform) => typeof platform !== 'string' || !PLATFORM_IDS.includes(platform as PlatformId),
    )
  ) {
    throw new ApiError(400, 'platforms contains an unsupported platform')
  }
  return unique as PlatformId[]
}

async function authorize(
  request: Request,
  serviceClient: SupabaseClient,
  memberId: string,
  serviceRoleKey: string,
): Promise<{
  requestedBy: string | null
  serviceRole: boolean
  admin: boolean
  profileCreatedAt: string | null
}> {
  const token = bearerToken(request)
  if (token === serviceRoleKey || gatewayVerifiedJwtRole(token) === 'service_role') {
    return {
      requestedBy: null,
      serviceRole: true,
      admin: true,
      profileCreatedAt: null,
    }
  }

  const { data: userData, error: userError } = await serviceClient.auth.getUser(token)
  if (userError || !userData.user) {
    throw new ApiError(401, 'Invalid or expired bearer token')
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role, review_status, created_at')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) {
    throw new Error(`Could not authorize administrator: ${profileError.message}`)
  }
  if (profile?.review_status !== 'approved')
    throw new ApiError(403, 'Approved membership is required')
  const admin = profile.role === 'admin'
  if (!admin && userData.user.id !== memberId) {
    throw new ApiError(403, 'Members may only synchronize their own account')
  }
  return {
    requestedBy: userData.user.id,
    serviceRole: false,
    admin,
    profileCreatedAt: profile.created_at,
  }
}

function eligibleAccount(account: PlatformAccount): boolean {
  return (
    account.status === 'verified' ||
    (account.platform === 'xcpc_elo' && ['pending', 'invalid'].includes(account.status))
  )
}

async function persistXcpcAccountResolution(
  client: SupabaseClient,
  account: PlatformAccount,
  result: AdapterResult,
): Promise<AdapterResult> {
  if (account.platform !== 'xcpc_elo') return result

  if (result.ok) {
    const { error } = await client
      .from('platform_accounts')
      .update({
        external_id: result.accountId,
        status: 'verified',
        verification_error_code: null,
        verification_error_message: null,
      })
      .eq('id', account.id)
    if (!error) return result
    if (error.code !== '23505') {
      throw new Error(`Could not persist XCPC ELO account resolution: ${error.message}`)
    }

    const duplicate = failure(
      'xcpc_elo',
      result.accountId,
      'invalid_account',
      'The matched XCPC ELO player is already linked to another member',
      false,
    )
    const { error: invalidError } = await client
      .from('platform_accounts')
      .update({
        status: 'invalid',
        verification_error_code: duplicate.error.code,
        verification_error_message: duplicate.error.message,
      })
      .eq('id', account.id)
    if (invalidError) {
      throw new Error(`Could not persist XCPC ELO account conflict: ${invalidError.message}`)
    }
    return duplicate
  }

  const identityFailure = ['invalid_account', 'not_found'].includes(result.error.code)
  if (account.status !== 'verified' || identityFailure) {
    const { error } = await client
      .from('platform_accounts')
      .update({
        status: identityFailure ? 'invalid' : account.status,
        verification_error_code: result.error.code,
        verification_error_message: result.error.message.slice(0, 2_000),
      })
      .eq('id', account.id)
    if (error) {
      throw new Error(`Could not persist XCPC ELO account failure: ${error.message}`)
    }
  }
  return result
}

function luoguAdapterState(state: LuoguSyncStateRow | undefined): unknown {
  if (!state) return undefined
  return {
    accountId: state.account_external_id,
    boundaryRecordId: state.boundary_record_id,
    boundarySubmitTime: state.boundary_submit_time,
    totalRecords: state.total_records,
    problemIds: state.problem_ids,
    lastFullSyncAt: state.last_full_sync_at,
  }
}

async function commitLuoguSyncResult(
  client: SupabaseClient,
  jobId: number,
  runId: number,
  account: PlatformAccount,
  existingState: LuoguSyncStateRow | undefined,
  result: AdapterResult,
  finishedAt: string,
  durationMs: number,
  currentRating: number | null,
  maxRating: number | null,
  solvedCount: number | null,
  status: 'fresh' | 'stale' | 'unavailable',
  sourceObservedAt: string | null,
  lastSuccessAt: string | null,
  staleAfter: string | null,
  sourceVersion: string | null,
): Promise<void> {
  if (account.platform !== 'luogu') return
  const state = result.ok ? result.syncState : null
  if (result.ok && (!state || typeof state !== 'object' || Array.isArray(state))) {
    throw new Error('Luogu adapter did not return a valid incremental state')
  }
  const nextState = (state ?? {}) as Record<string, unknown>
  const runMetrics = result.ok
    ? result.metrics
    : result.error.details
      ? { diagnostics: result.error.details }
      : null

  const { error } = await client.rpc('commit_luogu_sync_result', {
    target_platform_account_id: account.id,
    expected_external_id: account.external_id,
    expected_state_version: existingState?.state_version ?? 0,
    target_job_id: jobId,
    target_run_id: runId,
    sync_succeeded: result.ok,
    stat_current_rating: currentRating,
    stat_max_rating: maxRating,
    stat_solved_count: solvedCount,
    stat_status: status,
    stat_source_observed_at: sourceObservedAt,
    stat_fetched_at: result.fetchedAt,
    stat_last_success_at: lastSuccessAt,
    stat_stale_after: staleAfter,
    stat_error_code: result.ok ? null : result.error.code,
    stat_error_message: result.ok ? null : result.error.message.slice(0, 4_000),
    stat_source_version: sourceVersion,
    run_finished_at: finishedAt,
    run_duration_ms: durationMs,
    run_metrics: runMetrics,
    state_boundary_record_id: nextState.boundaryRecordId ?? null,
    state_boundary_submit_time: nextState.boundarySubmitTime ?? null,
    state_total_records: nextState.totalRecords ?? null,
    state_problem_ids: nextState.problemIds ?? null,
    state_last_full_sync_at: nextState.lastFullSyncAt ?? null,
  })
  if (error) {
    throw new Error(`Could not atomically commit Luogu synchronization: ${error.message}`)
  }
}

function publicAdapterResult(result: AdapterResult): AdapterResult {
  if (!result.ok) return result
  return {
    ok: true,
    platform: result.platform,
    accountId: result.accountId,
    metrics: result.metrics,
    fetchedAt: result.fetchedAt,
    sourceUpdatedAt: result.sourceUpdatedAt,
    sourceVersion: result.sourceVersion,
    details: result.details,
  }
}

async function persistResult(
  client: SupabaseClient,
  jobId: number,
  account: PlatformAccount,
  existing: ExistingStat | undefined,
  luoguState: LuoguSyncStateRow | undefined,
  memberName: string | undefined,
): Promise<{ result: AdapterResult; runId: number }> {
  const startedAt = new Date().toISOString()
  const { data: run, error: runError } = await client
    .from('sync_runs')
    .insert({
      job_id: jobId,
      profile_id: account.profile_id,
      platform: account.platform,
      platform_account_id: account.id,
      attempt: 1,
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single()
  if (runError) {
    throw new Error(`Could not create ${account.platform} sync run: ${runError.message}`)
  }

  try {
    // external_id preserves case for case-sensitive platforms. The normalized
    // value exists for uniqueness checks, not for upstream requests.
    const adapterResult = await adapters[account.platform].sync(account.external_id, {
      memberName,
      syncState: luoguAdapterState(luoguState),
    })
    const result = await persistXcpcAccountResolution(client, account, adapterResult)
    const finishedAt = new Date().toISOString()
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    const currentRating = result.ok
      ? result.metrics.currentRating
      : (existing?.current_rating ?? null)
    const maxRating = result.ok ? result.metrics.maxRating : (existing?.max_rating ?? null)
    const solvedCount = result.ok ? result.metrics.solvedCount : (existing?.solved_count ?? null)
    const retained = result.ok
      ? null
      : retainedFreshness(account.platform, existing?.last_success_at ?? null)
    const status = result.ok ? 'fresh' : (retained?.status ?? 'unavailable')
    const sourceObservedAt = result.ok
      ? result.sourceUpdatedAt
      : (existing?.source_observed_at ?? null)
    const lastSuccessAt = result.ok ? result.fetchedAt : (existing?.last_success_at ?? null)
    const staleAfter = result.ok
      ? freshnessDeadline(account.platform, result.fetchedAt)
      : (retained?.staleAfter ?? null)
    const sourceVersion = result.ok ? result.sourceVersion : (existing?.source_version ?? null)

    const statRow = {
      profile_id: account.profile_id,
      platform: account.platform,
      current_rating: currentRating,
      max_rating: maxRating,
      solved_count: solvedCount,
      status,
      source_observed_at: sourceObservedAt,
      fetched_at: result.fetchedAt,
      last_success_at: lastSuccessAt,
      stale_after: staleAfter,
      error_code: result.ok ? null : result.error.code,
      error_message: result.ok ? null : result.error.message.slice(0, 4_000),
      source_version: sourceVersion,
      updated_at: finishedAt,
    }

    if (account.platform === 'luogu') {
      await commitLuoguSyncResult(
        client,
        jobId,
        run.id as number,
        account,
        luoguState,
        result,
        finishedAt,
        durationMs,
        currentRating,
        maxRating,
        solvedCount,
        status,
        sourceObservedAt,
        lastSuccessAt,
        staleAfter,
        sourceVersion,
      )
      return { result, runId: run.id as number }
    }

    const { error: statError } = await client
      .from('platform_stats')
      .upsert(statRow, { onConflict: 'profile_id,platform' })
    if (statError) {
      throw new Error(`Could not persist ${account.platform} stats: ${statError.message}`)
    }

    const snapshotRow = {
      profile_id: account.profile_id,
      platform: account.platform,
      sync_run_id: run.id,
      current_rating: currentRating,
      max_rating: maxRating,
      solved_count: solvedCount,
      status,
      source_observed_at: sourceObservedAt,
      recorded_at: finishedAt,
    }
    const { error: snapshotError } = await client
      .from('stat_snapshots')
      .upsert(snapshotRow, { onConflict: 'profile_id,platform,sync_run_id' })
    if (snapshotError) {
      throw new Error(`Could not persist ${account.platform} snapshot: ${snapshotError.message}`)
    }

    const { error: finishRunError } = await client
      .from('sync_runs')
      .update({
        status: result.ok ? 'succeeded' : 'failed',
        finished_at: finishedAt,
        duration_ms: durationMs,
        error_code: result.ok ? null : result.error.code,
        error_message: result.ok ? null : result.error.message.slice(0, 4_000),
        source_version: sourceVersion,
        metrics: result.ok
          ? result.metrics
          : result.error.details
            ? { diagnostics: result.error.details }
            : null,
      })
      .eq('id', run.id)
    if (finishRunError) {
      throw new Error(`Could not finish ${account.platform} sync run: ${finishRunError.message}`)
    }

    return { result, runId: run.id as number }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'Unknown persistence error'
    await client
      .from('sync_runs')
      .update({
        status: 'failed',
        finished_at: finishedAt,
        duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        error_code: 'unknown',
        error_message: message.slice(0, 4_000),
        metrics: null,
      })
      .eq('id', run.id)
    throw error
  }
}

Deno.serve(async (request) => {
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, request)
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) })
  }
  if (request.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405)
  }

  let jobId: number | null = null
  let serviceClient: SupabaseClient | null = null
  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    let body: SyncRequest
    try {
      body = (await request.json()) as SyncRequest
    } catch {
      throw new ApiError(400, 'Request body must be valid JSON')
    }
    if (!isUuid(body.memberId)) {
      throw new ApiError(400, 'memberId must be a UUID')
    }
    const auth = await authorize(request, serviceClient, body.memberId, serviceRoleKey)
    const platforms = selectedPlatforms(body.platforms)
    const triggerType = body.triggerType ?? (auth.serviceRole ? 'scheduled' : 'manual')
    if (!SYNC_TRIGGER_TYPES.includes(triggerType)) {
      throw new ApiError(400, 'Unsupported triggerType')
    }
    if (!canRequestSync(auth, triggerType, platforms)) {
      if (!auth.admin) {
        throw new ApiError(
          403,
          'Members may only request their own XCPC ELO synchronization during registration',
        )
      }
      throw new ApiError(
        403,
        'Administrators may only request registration, account-change, manual, or retry synchronization',
      )
    }
    const memberRegistrationSync =
      !auth.serviceRole && !auth.admin && triggerType === 'registration'
    if (memberRegistrationSync && !isRegistrationSyncWindowOpen(auth.profileCreatedAt)) {
      throw new ApiError(403, 'The XCPC ELO registration synchronization window has expired')
    }

    const { data: memberProfile, error: memberProfileError } = await serviceClient
      .from('profiles')
      .select('full_name, review_status')
      .eq('id', body.memberId)
      .single()
    if (memberProfileError) {
      throw new Error(`Could not load member identity: ${memberProfileError.message}`)
    }
    if (memberProfile.review_status !== 'approved') {
      throw new ApiError(403, 'Only approved members may be synchronized')
    }

    let accountsQuery = serviceClient
      .from('platform_accounts')
      .select('id, profile_id, platform, external_id, status')
      .eq('profile_id', body.memberId)
    if (platforms) accountsQuery = accountsQuery.in('platform', platforms)
    const { data: accountRows, error: accountsError } = await accountsQuery
    if (accountsError) {
      throw new Error(`Could not load platform accounts: ${accountsError.message}`)
    }
    const accounts = ((accountRows ?? []) as PlatformAccount[]).filter(eligibleAccount)
    if (accounts.length === 0) {
      throw new ApiError(404, 'No eligible platform accounts matched the request')
    }

    const memberName = memberProfile.full_name?.trim() || undefined
    if (accounts.some((account) => account.platform === 'xcpc_elo') && !memberName) {
      throw new ApiError(422, 'A member name is required to verify the XCPC ELO binding')
    }

    const syncedPlatforms = accounts.map((account) => account.platform).sort()
    const jobTarget = buildSyncJobTarget(body.memberId, platforms, syncedPlatforms)

    const { data: job, error: jobError } = await serviceClient
      .from('sync_jobs')
      .insert({
        ...jobTarget,
        status: 'queued',
        trigger_type: triggerType,
        requested_by: auth.requestedBy,
      })
      .select('id, created_at')
      .single()
    if (jobError) {
      if (jobError.code === '23505') {
        if (memberRegistrationSync) {
          throw new ApiError(409, 'XCPC ELO registration synchronization was already requested')
        }
        throw new ApiError(409, 'A synchronization job is already active for this member')
      }
      throw new Error(`Could not create sync job: ${jobError.message}`)
    }
    jobId = job.id as number
    const { error: startJobError } = await serviceClient
      .from('sync_jobs')
      .update({ status: 'running', started_at: job.created_at })
      .eq('id', jobId)
    if (startJobError) {
      throw new Error(`Could not start sync job: ${startJobError.message}`)
    }

    const { data: statsRows, error: statsError } = await serviceClient
      .from('platform_stats')
      .select(
        'profile_id, platform, current_rating, max_rating, solved_count, source_observed_at, last_success_at, source_version',
      )
      .eq('profile_id', body.memberId)
      .in(
        'platform',
        accounts.map((account) => account.platform),
      )
    if (statsError) {
      throw new Error(`Could not load existing stats: ${statsError.message}`)
    }
    const existingByPlatform = new Map(
      ((statsRows ?? []) as ExistingStat[]).map((stat) => [stat.platform, stat]),
    )

    const luoguAccountIds = accounts
      .filter((account) => account.platform === 'luogu')
      .map((account) => account.id)
    let luoguStateRows: LuoguSyncStateRow[] = []
    if (luoguAccountIds.length > 0) {
      const { data, error } = await serviceClient
        .from('luogu_sync_states')
        .select(
          'platform_account_id, account_external_id, state_version, boundary_record_id, boundary_submit_time, total_records, problem_ids, last_full_sync_at',
        )
        .in('platform_account_id', luoguAccountIds)
      if (error) {
        throw new Error(`Could not load Luogu incremental state: ${error.message}`)
      }
      luoguStateRows = (data ?? []) as LuoguSyncStateRow[]
    }
    const luoguStateByAccount = new Map(
      luoguStateRows.map((state) => [state.platform_account_id, state]),
    )

    const persisted = await Promise.all(
      accounts.map(async (account) => {
        return await persistResult(
          serviceClient!,
          jobId!,
          account,
          existingByPlatform.get(account.platform),
          luoguStateByAccount.get(account.id),
          memberName,
        )
      }),
    )

    const failures = persisted.filter(({ result }) => !result.ok)
    const finishedAt = new Date().toISOString()
    const firstFailure = failures[0]?.result
    const { error: finishJobError } = await serviceClient
      .from('sync_jobs')
      .update({
        status: failures.length === 0 ? 'succeeded' : 'failed',
        finished_at: finishedAt,
        last_error_code: firstFailure && !firstFailure.ok ? firstFailure.error.code : null,
        last_error_message:
          firstFailure && !firstFailure.ok ? firstFailure.error.message.slice(0, 4_000) : null,
      })
      .eq('id', jobId)
    if (finishJobError) {
      throw new Error(`Could not finish sync job: ${finishJobError.message}`)
    }

    return respond(
      {
        jobId,
        memberId: body.memberId,
        status: failures.length === 0 ? 'succeeded' : 'failed',
        results: persisted.map(({ result, runId }) => ({ runId, ...publicAdapterResult(result) })),
      },
      failures.length === 0 ? 200 : 207,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error'
    if (jobId !== null && serviceClient) {
      await serviceClient
        .from('sync_jobs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          last_error_code: 'unknown',
          last_error_message: message.slice(0, 1_000),
        })
        .eq('id', jobId)
    }
    const status = error instanceof ApiError ? error.status : 500
    return respond({ error: message }, status)
  }
})
