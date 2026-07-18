import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AdminRateLimitError, consumeAdminRateLimit } from '../_shared/admin-rate-limit.ts'
import {
  type AdapterResult,
  adapters,
  PLATFORM_IDS,
  type PlatformAdapter,
  type PlatformId,
} from '../_shared/adapters/index.ts'
import { notifySyncFailure, shouldNotifySyncFailure } from '../_shared/alerts.ts'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { createXcpcEloAdapter } from '../_shared/adapters/xcpc-elo.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  createRuntimeNowcoderAdapter,
  createRuntimeQojAdapter,
} from '../_shared/firecrawl-runtime-adapters.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import { createSupabaseXcpcDatasetLoader } from '../_shared/xcpc-cache.ts'
import {
  canRequestSync,
  isRegistrationSyncWindowOpen,
  SYNC_TRIGGER_TYPES,
  type SyncTriggerType,
} from './access.ts'
import {
  buildPlatformAccountVerificationUpdate,
  duplicatePlatformAccountFailure,
  isPlatformAccountEligible,
} from './account-verification.ts'
import { buildSyncJobTarget } from './job.ts'
import { completeSyncJobAttempt } from './job-completion.ts'
import { buildPlatformPersistenceState, persistNonLuoguResult } from './persistence.ts'
import { maxAttemptsForPlatforms, mayAutomaticallyRetryPlatformFailure } from './retry.ts'

interface SyncRequest {
  memberId?: string
  platforms?: PlatformId[]
  triggerType?: SyncTriggerType
  jobId?: number
}

interface PlatformAccount {
  id: number
  profile_id: string
  platform: PlatformId
  external_id: string
  status: 'pending' | 'verified' | 'invalid' | 'disabled'
  updated_at: string
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

interface ClaimedSyncJob {
  id: number
  profile_id: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  trigger_type: SyncTriggerType
  attempt_count: number
  max_attempts: number
  payload: unknown
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
  if (profile?.review_status !== 'approved') {
    throw new ApiError(403, 'Approved membership is required')
  }
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

async function persistPlatformAccountVerification(
  client: SupabaseClient,
  account: PlatformAccount,
  result: AdapterResult,
  triggerType: SyncTriggerType,
): Promise<AdapterResult> {
  const update = buildPlatformAccountVerificationUpdate(account, result, triggerType)
  if (!update) return result

  const updateResult = await client
    .from('platform_accounts')
    .update(update)
    .eq('id', account.id)
    .eq('external_id', account.external_id)
    .eq('updated_at', account.updated_at)
    .select('id')
    .maybeSingle()
  const { data: updatedAccount, error } = updateResult
  if (!error && updatedAccount) return result
  if (!error) {
    throw new Error(`The ${account.platform} account changed while verification was running`)
  }
  if (!result.ok || error.code !== '23505') {
    throw new Error(`Could not persist ${account.platform} account verification: ${error.message}`)
  }

  const duplicate = duplicatePlatformAccountFailure(account.platform, result.accountId)
  const { data: invalidAccount, error: invalidError } = await client
    .from('platform_accounts')
    .update({
      status: 'invalid',
      verification_error_code: duplicate.error.code,
      verification_error_message: duplicate.error.message,
    })
    .eq('id', account.id)
    .eq('external_id', account.external_id)
    .eq('updated_at', account.updated_at)
    .select('id')
    .maybeSingle()
  if (invalidError || !invalidAccount) {
    throw new Error(
      invalidError
        ? `Could not persist ${account.platform} account conflict: ${invalidError.message}`
        : `The ${account.platform} account changed while verification was running`,
    )
  }
  return duplicate
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
  attempt: number,
  account: PlatformAccount,
  existing: ExistingStat | undefined,
  luoguState: LuoguSyncStateRow | undefined,
  memberName: string | undefined,
  xcpcAdapter: PlatformAdapter | null,
  triggerType: SyncTriggerType,
): Promise<{ result: AdapterResult; runId: number }> {
  const startedAt = new Date().toISOString()
  const { data: run, error: runError } = await client
    .from('sync_runs')
    .insert({
      job_id: jobId,
      profile_id: account.profile_id,
      platform: account.platform,
      platform_account_id: account.id,
      attempt,
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
    const adapter =
      account.platform === 'xcpc_elo'
        ? xcpcAdapter
        : account.platform === 'qoj'
          ? createRuntimeQojAdapter(client, {
              operationId: `qoj:${jobId}:${attempt}:${account.id}`,
            })
          : account.platform === 'nowcoder'
            ? createRuntimeNowcoderAdapter(client)
            : adapters[account.platform]
    if (!adapter) {
      throw new Error('XCPC ELO shared cache adapter is unavailable')
    }
    const adapterResult = await adapter.sync(account.external_id, {
      memberName,
      syncState: luoguAdapterState(luoguState),
    })
    const result = await persistPlatformAccountVerification(
      client,
      account,
      adapterResult,
      triggerType,
    )
    const finishedAt = new Date().toISOString()
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    const persistenceState = buildPlatformPersistenceState(
      account.platform,
      existing
        ? {
            currentRating: existing.current_rating,
            maxRating: existing.max_rating,
            solvedCount: existing.solved_count,
            sourceObservedAt: existing.source_observed_at,
            lastSuccessAt: existing.last_success_at,
            sourceVersion: existing.source_version,
          }
        : undefined,
      result,
      finishedAt,
    )

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
        persistenceState.currentRating,
        persistenceState.maxRating,
        persistenceState.solvedCount,
        persistenceState.status,
        persistenceState.sourceObservedAt,
        persistenceState.lastSuccessAt,
        persistenceState.staleAfter,
        persistenceState.sourceVersion,
      )
      return { result, runId: run.id as number }
    }

    await persistNonLuoguResult(
      client,
      jobId,
      run.id as number,
      {
        id: account.id,
        platform: account.platform,
        externalId: account.external_id,
      },
      result,
      persistenceState,
      startedAt,
      finishedAt,
    )

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
      .eq('status', 'running')
    throw error
  }
}

Deno.serve(async (request) => {
  const respond = (body: unknown, status = 200, additionalHeaders: Record<string, string> = {}) =>
    jsonResponse(body, status, request, additionalHeaders)
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) })
  }
  if (request.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405)
  }

  let jobId: number | null = null
  let jobAttempt = 1
  let jobMaxAttempts = 1
  let jobPlatforms: PlatformId[] = []
  let jobTriggerType: SyncTriggerType = 'scheduled'
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
    let platforms = selectedPlatforms(body.platforms)
    let triggerType = body.triggerType ?? (auth.serviceRole ? 'scheduled' : 'manual')

    if (body.jobId !== undefined) {
      if (!auth.serviceRole) {
        throw new ApiError(403, 'Only the queue worker may resume a job')
      }
      if (!Number.isSafeInteger(body.jobId) || body.jobId < 1) {
        throw new ApiError(400, 'jobId must be a positive integer')
      }
      const { data: claimedJob, error: claimedJobError } = await serviceClient
        .from('sync_jobs')
        .select('id, profile_id, status, trigger_type, attempt_count, max_attempts, payload')
        .eq('id', body.jobId)
        .maybeSingle()
      if (claimedJobError) {
        throw new Error(`Could not load claimed sync job: ${claimedJobError.message}`)
      }
      const existingJob = claimedJob as ClaimedSyncJob | null
      if (!existingJob) {
        throw new ApiError(404, 'Claimed synchronization job was not found')
      }
      if (existingJob.status !== 'running' || existingJob.profile_id !== body.memberId) {
        throw new ApiError(409, 'Synchronization job is not claimed for this member')
      }
      const payload =
        existingJob.payload !== null &&
        typeof existingJob.payload === 'object' &&
        !Array.isArray(existingJob.payload)
          ? (existingJob.payload as Record<string, unknown>)
          : {}
      const claimedPlatforms = selectedPlatforms(payload.platforms)
      if (
        !platforms ||
        platforms.length !== claimedPlatforms?.length ||
        platforms.some((platform, index) => platform !== claimedPlatforms[index])
      ) {
        throw new ApiError(409, 'Synchronization job payload does not match the worker request')
      }
      platforms = claimedPlatforms
      triggerType = existingJob.trigger_type
      jobId = existingJob.id
      jobAttempt = existingJob.attempt_count
      jobMaxAttempts = existingJob.max_attempts
    }
    if (!SYNC_TRIGGER_TYPES.includes(triggerType)) {
      throw new ApiError(400, 'Unsupported triggerType')
    }
    jobTriggerType = triggerType
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
    if (!auth.serviceRole && auth.admin && auth.requestedBy) {
      await consumeAdminRateLimit(serviceClient, auth.requestedBy, {
        actionKey: 'admin.sync.member-total',
        maxRequests: 300,
        windowSeconds: 3600,
      })
      await consumeAdminRateLimit(serviceClient, auth.requestedBy, {
        actionKey: `admin.sync.member:${body.memberId}`,
        maxRequests: 12,
        windowSeconds: 60,
      })
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
      .select('id, profile_id, platform, external_id, status, updated_at')
      .eq('profile_id', body.memberId)
    if (platforms) accountsQuery = accountsQuery.in('platform', platforms)
    const { data: accountRows, error: accountsError } = await accountsQuery
    if (accountsError) {
      throw new Error(`Could not load platform accounts: ${accountsError.message}`)
    }
    const accounts = ((accountRows ?? []) as PlatformAccount[]).filter((account) =>
      isPlatformAccountEligible(account, triggerType),
    )
    if (accounts.length === 0) {
      throw new ApiError(404, 'No eligible platform accounts matched the request')
    }

    const memberName = memberProfile.full_name?.trim() || undefined
    if (accounts.some((account) => account.platform === 'xcpc_elo') && !memberName) {
      throw new ApiError(422, 'A member name is required to verify the XCPC ELO binding')
    }

    const syncedPlatforms = accounts.map((account) => account.platform).sort()
    jobPlatforms = syncedPlatforms
    if (jobId === null) {
      const jobTarget = buildSyncJobTarget(body.memberId, platforms, syncedPlatforms)
      jobMaxAttempts = maxAttemptsForPlatforms(syncedPlatforms)

      const { data: job, error: jobError } = await serviceClient
        .from('sync_jobs')
        .insert({
          ...jobTarget,
          status: 'queued',
          trigger_type: triggerType,
          requested_by: auth.requestedBy,
          attempt_count: 0,
          max_attempts: jobMaxAttempts,
          scheduled_for: new Date(Date.now() + 60_000).toISOString(),
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
      const { data: startedJob, error: startJobError } = await serviceClient
        .from('sync_jobs')
        .update({
          status: 'running',
          attempt_count: jobAttempt,
          started_at: job.created_at,
        })
        .eq('id', jobId)
        .eq('status', 'queued')
        .eq('attempt_count', 0)
        .select('id')
        .maybeSingle()
      if (startJobError || !startedJob) {
        throw new Error(
          startJobError
            ? `Could not start sync job: ${startJobError.message}`
            : 'Synchronization job was claimed before its initial attempt started',
        )
      }
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
    const xcpcAdapter = accounts.some((account) => account.platform === 'xcpc_elo')
      ? createXcpcEloAdapter(createSupabaseXcpcDatasetLoader(serviceClient))
      : null

    const persisted = await Promise.all(
      accounts.map(async (account) => {
        return await persistResult(
          serviceClient!,
          jobId!,
          jobAttempt,
          account,
          existingByPlatform.get(account.platform),
          luoguStateByAccount.get(account.id),
          memberName,
          xcpcAdapter,
          triggerType,
        )
      }),
    )

    const failures = persisted.filter(({ result }) => !result.ok)
    const firstFailure = failures[0]?.result
    const completion = await completeSyncJobAttempt(serviceClient, {
      jobId,
      attempt: jobAttempt,
      succeeded: failures.length === 0,
      retryable:
        persisted.length === 1 &&
        firstFailure !== undefined &&
        !firstFailure.ok &&
        mayAutomaticallyRetryPlatformFailure(firstFailure.platform, firstFailure.error.retryable),
      errorCode: firstFailure && !firstFailure.ok ? firstFailure.error.code : null,
      errorMessage: firstFailure && !firstFailure.ok ? firstFailure.error.message : null,
    })
    if (!completion.transitioned) {
      throw new ApiError(409, 'Synchronization attempt is no longer current')
    }
    if (!['queued', 'succeeded', 'failed'].includes(completion.status)) {
      throw new Error(`Synchronization attempt reached invalid status ${completion.status}`)
    }

    const alertFailures = failures.flatMap(({ result }) =>
      result.ok || !shouldNotifySyncFailure(result.error.code)
        ? []
        : [{ platform: result.platform, code: result.error.code }],
    )
    if (completion.status === 'failed' && alertFailures.length > 0) {
      await notifySyncFailure({
        jobId,
        triggerType,
        attempt: jobAttempt,
        maxAttempts: jobMaxAttempts,
        failedAt: completion.transitionedAt ?? new Date().toISOString(),
        failures: alertFailures,
      })
    }

    return respond(
      {
        jobId,
        memberId: body.memberId,
        status: completion.status,
        attempt: jobAttempt,
        maxAttempts: jobMaxAttempts,
        retryAt: completion.retryAt,
        results: persisted.map(({ result, runId }) => ({
          runId,
          ...publicAdapterResult(result),
        })),
      },
      completion.status === 'queued' ? 202 : completion.status === 'succeeded' ? 200 : 207,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error'
    if (!(error instanceof ApiError) && !(error instanceof AdminRateLimitError)) {
      await notifyRuntimeError(runtimeErrorAlert('sync-member', request, error))
    }
    if (jobId !== null && serviceClient) {
      try {
        const completion = await completeSyncJobAttempt(serviceClient, {
          jobId,
          attempt: jobAttempt,
          succeeded: false,
          errorCode: 'unknown',
          errorMessage: message.slice(0, 1_000),
        })
        if (completion.transitioned && completion.status === 'failed' && jobPlatforms.length > 0) {
          await notifySyncFailure({
            jobId,
            triggerType: jobTriggerType,
            attempt: jobAttempt,
            maxAttempts: jobMaxAttempts,
            failedAt: completion.transitionedAt ?? new Date().toISOString(),
            failures: jobPlatforms.map((platform) => ({
              platform,
              code: 'unknown',
            })),
          })
        }
      } catch (completionError) {
        console.error(
          JSON.stringify({
            event: 'sync_job_completion_failed',
            jobId,
            errorType:
              completionError instanceof Error ? completionError.name : typeof completionError,
          }),
        )
      }
    }
    if (error instanceof AdminRateLimitError) {
      return respond(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        429,
        { 'retry-after': String(error.retryAfterSeconds) },
      )
    }
    const status = error instanceof ApiError ? error.status : 500
    return respond({ error: message }, status)
  }
})
