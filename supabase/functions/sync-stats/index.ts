import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AdminRateLimitError, consumeAdminRateLimit } from '../_shared/admin-rate-limit.ts'
import { notifyFirecrawlCreditAlert } from '../_shared/alerts.ts'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { PLATFORM_IDS, type PlatformId } from '../_shared/adapters/index.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { readFirecrawlCreditUsage } from '../_shared/firecrawl-usage.ts'
import { toAdapterHttpError } from '../_shared/http.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import {
  type PlatformMemberSyncResult,
  summarizeMemberSyncResults,
  summarizePlatformSyncResults,
} from '../_shared/sync-result.ts'
import { createSupabaseXcpcDatasetLoader } from '../_shared/xcpc-cache.ts'
import { dispatchWithPlatformLimits, type SyncDispatchTarget } from './dispatch.ts'
import { shouldCheckFirecrawlCredits } from './firecrawl-monitor.ts'
import { buildCursorPage } from './pagination.ts'
import {
  maySyncXcpcElo,
  normalizeSyncRequest,
  type SyncRequest,
  SyncRequestError,
} from './request.ts'

interface AccountRow {
  id: number
  profile_id: string
  platform: PlatformId
}

interface ClaimedQueueJobRow {
  job_id: number
  profile_id: string
  platform: PlatformId | null
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
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApiError(401, 'Missing bearer token')
  return match[1]
}

async function authorize(
  token: string,
  serviceClient: SupabaseClient,
  serviceRoleKey: string,
): Promise<{ serviceRole: boolean; actorId: string | null }> {
  if (token === serviceRoleKey || gatewayVerifiedJwtRole(token) === 'service_role') {
    return { serviceRole: true, actorId: null }
  }

  const { data, error } = await serviceClient.auth.getUser(token)
  if (error || !data.user) {
    throw new ApiError(401, 'Invalid or expired bearer token')
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role, review_status')
    .eq('id', data.user.id)
    .maybeSingle()
  if (profileError) {
    throw new Error(`Could not authorize administrator: ${profileError.message}`)
  }
  if (profile?.role !== 'admin' || profile.review_status !== 'approved') {
    throw new ApiError(403, 'Administrator access is required')
  }
  return { serviceRole: false, actorId: data.user.id }
}

function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && PLATFORM_IDS.includes(value as PlatformId)
}

function queueJobPlatform(row: ClaimedQueueJobRow): PlatformId {
  if (!isPlatformId(row.platform)) {
    throw new Error(`Claimed synchronization job ${row.job_id} has no platform target`)
  }
  const payload =
    row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}
  if (
    !Array.isArray(payload.platforms) ||
    payload.platforms.length !== 1 ||
    payload.platforms[0] !== row.platform
  ) {
    throw new Error(`Claimed synchronization job ${row.job_id} has an invalid payload`)
  }
  return row.platform
}

async function claimQueueTargets(serviceClient: SupabaseClient): Promise<SyncDispatchTarget[]> {
  const { data, error } = await serviceClient.rpc('claim_due_sync_jobs', {
    batch_limit: 12,
    stale_timeout: '15 minutes',
  })
  if (error) {
    throw new Error(`Could not claim synchronization queue: ${error.message}`)
  }

  return ((data ?? []) as ClaimedQueueJobRow[]).map((row) => ({
    memberId: row.profile_id,
    platform: queueJobPlatform(row),
    jobId: row.job_id,
  }))
}

async function loadRequestedTargets(
  serviceClient: SupabaseClient,
  platforms: PlatformId[] | undefined,
  memberId: string | undefined,
  batchSize: number | undefined,
  cursor: number | undefined,
): Promise<{ targets: SyncDispatchTarget[]; nextCursor: number | null }> {
  let query = serviceClient
    .from('platform_accounts')
    .select('id, profile_id, platform, profiles!inner(review_status)')
    .eq('status', 'verified')
    .eq('profiles.review_status', 'approved')
  if (platforms) query = query.in('platform', platforms)
  if (memberId) query = query.eq('profile_id', memberId)
  if (cursor !== undefined) query = query.gt('id', cursor)
  query = query.order('id', { ascending: true })
  if (batchSize !== undefined) query = query.limit(batchSize + 1)

  const { data, error } = await query
  if (error) {
    throw new Error(`Could not load verified accounts: ${error.message}`)
  }

  const page = buildCursorPage((data ?? []) as AccountRow[], batchSize)
  const seen = new Set<string>()
  const targets: SyncDispatchTarget[] = []
  for (const row of page.rows) {
    const key = `${row.profile_id}:${row.platform}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ memberId: row.profile_id, platform: row.platform })
  }
  return { targets, nextCursor: page.nextCursor }
}

async function invokeSyncMember(
  target: SyncDispatchTarget,
  supabaseUrl: string,
  serviceRoleKey: string,
  token: string,
  triggerType: 'scheduled' | 'manual',
): Promise<PlatformMemberSyncResult> {
  const response = await fetch(`${supabaseUrl}/functions/v1/sync-member`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      apikey: serviceRoleKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      memberId: target.memberId,
      platforms: [target.platform],
      ...(target.jobId ? { jobId: target.jobId } : { triggerType }),
    }),
  })
  let responseBody: unknown
  try {
    responseBody = await response.json()
  } catch {
    responseBody = { error: 'Invalid sync-member response' }
  }
  return {
    memberId: target.memberId,
    platform: target.platform,
    status: response.status,
    body: responseBody,
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

  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const token = bearerToken(request)
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const auth = await authorize(token, serviceClient, serviceRoleKey)

    let body: SyncRequest
    try {
      body = (await request.json()) as SyncRequest
    } catch {
      throw new ApiError(400, 'Request body must be valid JSON')
    }

    let normalizedRequest
    try {
      normalizedRequest = normalizeSyncRequest(body)
    } catch (error) {
      if (error instanceof SyncRequestError) {
        throw new ApiError(400, error.message)
      }
      throw error
    }
    const { scope, platforms, memberId, batchSize, cursor } = normalizedRequest
    if (scope === 'queue' && !auth.serviceRole) {
      throw new ApiError(403, 'Only the service role may process the synchronization queue')
    }
    if (!auth.serviceRole && auth.actorId) {
      await consumeAdminRateLimit(
        serviceClient,
        auth.actorId,
        scope === 'all'
          ? { actionKey: 'admin.sync.all', maxRequests: 2, windowSeconds: 600 }
          : {
              actionKey: 'admin.sync.scoped',
              maxRequests: 12,
              windowSeconds: 60,
            },
      )
    }

    let nextCursor: number | null = null
    let targets: SyncDispatchTarget[]
    if (scope === 'queue') {
      targets = await claimQueueTargets(serviceClient)
    } else {
      const loaded = await loadRequestedTargets(
        serviceClient,
        platforms,
        memberId,
        batchSize,
        cursor,
      )
      targets = loaded.targets
      nextCursor = loaded.nextCursor
    }
    if (targets.length === 0 && !auth.serviceRole) {
      throw new ApiError(404, 'No approved members or verified accounts matched the request')
    }
    if (targets.length === 0) {
      return respond({
        scope,
        platforms: platforms ?? null,
        ...summarizeMemberSyncResults([]),
        byPlatform: [],
        nextCursor,
        results: [],
      })
    }

    if (
      maySyncXcpcElo(normalizedRequest) &&
      targets.some((target) => target.platform === 'xcpc_elo')
    ) {
      try {
        await createSupabaseXcpcDatasetLoader(serviceClient)()
      } catch (error) {
        const normalized = toAdapterHttpError(error)
        console.warn(
          `XCPC ELO cache preparation failed (${normalized.code}): ${normalized.message}`,
        )
      }
    }

    if (shouldCheckFirecrawlCredits(auth.serviceRole, scope, platforms, cursor)) {
      try {
        const usage = await readFirecrawlCreditUsage()
        if (
          usage.configured &&
          usage.severity &&
          usage.remainingCredits !== null &&
          usage.planCredits !== null &&
          usage.percentRemaining !== null
        ) {
          await notifyFirecrawlCreditAlert({
            checkedAt: new Date().toISOString(),
            remainingCredits: usage.remainingCredits,
            planCredits: usage.planCredits,
            percentRemaining: Number(usage.percentRemaining.toFixed(2)),
            billingPeriodEnd: usage.billingPeriodEnd,
            severity: usage.severity,
          })
        }
      } catch {
        console.warn(JSON.stringify({ event: 'firecrawl_credit_check_failed' }))
      }
    }

    const triggerType = auth.serviceRole ? 'scheduled' : 'manual'
    const results = await dispatchWithPlatformLimits(
      targets,
      (target) => invokeSyncMember(target, supabaseUrl, serviceRoleKey, token, triggerType),
      (target, error): PlatformMemberSyncResult => {
        console.error(
          JSON.stringify({
            event: 'sync_member_transport_failed',
            platform: target.platform,
            jobId: target.jobId ?? null,
            errorType: error instanceof Error ? error.name : typeof error,
          }),
        )
        return {
          memberId: target.memberId,
          platform: target.platform,
          status: 502,
          body: {
            status: 'failed',
            error: 'sync-member transport request failed',
            errorCode: 'network_error',
            platform: target.platform,
            jobId: target.jobId ?? null,
          },
        }
      },
    )
    const summary = summarizeMemberSyncResults(results)
    const byPlatform = summarizePlatformSyncResults(results)
    const responseStatus = summary.failed > 0 ? 207 : summary.queued > 0 ? 202 : 200
    return respond(
      {
        scope,
        platforms: platforms ?? null,
        ...summary,
        byPlatform,
        nextCursor,
        results,
      },
      responseStatus,
    )
  } catch (error) {
    if (error instanceof AdminRateLimitError) {
      return respond(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        429,
      )
    }
    const status = error instanceof ApiError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Unknown batch sync error'
    if (!(error instanceof ApiError)) {
      await notifyRuntimeError(runtimeErrorAlert('sync-stats', request, error))
    }
    return respond({ error: message }, status)
  }
})
