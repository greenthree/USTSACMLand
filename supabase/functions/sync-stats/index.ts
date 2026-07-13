import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import { type MemberSyncResult, summarizeMemberSyncResults } from '../_shared/sync-result.ts'
import { normalizeSyncRequest, type SyncRequest, SyncRequestError } from './request.ts'

interface AccountRow {
  profile_id: string
}

interface ProfileRow {
  id: string
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
): Promise<{ serviceRole: boolean }> {
  if (token === serviceRoleKey || gatewayVerifiedJwtRole(token) === 'service_role') {
    return { serviceRole: true }
  }

  const { data, error } = await serviceClient.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'Invalid or expired bearer token')

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role, review_status')
    .eq('id', data.user.id)
    .maybeSingle()
  if (profileError) throw new Error(`Could not authorize administrator: ${profileError.message}`)
  if (profile?.role !== 'admin' || profile.review_status !== 'approved') {
    throw new ApiError(403, 'Administrator access is required')
  }
  return { serviceRole: false }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size))
  return result
}

Deno.serve(async (request) => {
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

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
      if (error instanceof SyncRequestError) throw new ApiError(400, error.message)
      throw error
    }
    const { scope, platforms, memberId } = normalizedRequest

    let memberIds: string[]
    if (scope === 'all' || platforms?.includes('xcpc_elo')) {
      const { data: profiles, error: profilesError } = await serviceClient
        .from('profiles')
        .select('id')
        .eq('review_status', 'approved')
      if (profilesError)
        throw new Error(`Could not load approved members: ${profilesError.message}`)
      memberIds = ((profiles ?? []) as ProfileRow[]).map((row) => row.id)
    } else {
      let accountsQuery = serviceClient
        .from('platform_accounts')
        .select('profile_id, profiles!inner(review_status)')
        .eq('status', 'verified')
        .eq('profiles.review_status', 'approved')
      if (platforms) accountsQuery = accountsQuery.in('platform', platforms)
      if (scope === 'member') accountsQuery = accountsQuery.eq('profile_id', memberId)

      const { data: accounts, error: accountsError } = await accountsQuery
      if (accountsError) {
        throw new Error(`Could not load verified accounts: ${accountsError.message}`)
      }
      memberIds = [...new Set(((accounts ?? []) as AccountRow[]).map((row) => row.profile_id))]
    }
    if (memberIds.length === 0 && !auth.serviceRole)
      throw new ApiError(404, 'No approved members or verified accounts matched the request')

    if (memberIds.length === 0) {
      const summary = summarizeMemberSyncResults([])
      return respond({
        scope,
        platforms: platforms ?? null,
        ...summary,
        results: [],
      })
    }

    const results: MemberSyncResult[] = []
    for (const batch of chunks(memberIds, 4)) {
      const batchResults = await Promise.all(
        batch.map(async (memberId) => {
          const response = await fetch(`${supabaseUrl}/functions/v1/sync-member`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              apikey: serviceRoleKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              memberId,
              platforms,
              triggerType: auth.serviceRole ? 'scheduled' : 'manual',
            }),
          })
          let responseBody: unknown
          try {
            responseBody = await response.json()
          } catch {
            responseBody = { error: 'Invalid sync-member response' }
          }
          return { memberId, status: response.status, body: responseBody }
        }),
      )
      results.push(...batchResults)
    }

    const summary = summarizeMemberSyncResults(results)
    return respond(
      {
        scope,
        platforms: platforms ?? null,
        ...summary,
        results,
      },
      summary.failed === 0 ? 200 : 207,
    )
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Unknown batch sync error'
    return respond({ error: message }, status)
  }
})
