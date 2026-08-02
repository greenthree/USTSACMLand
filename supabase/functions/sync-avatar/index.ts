import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import { normalizeImage } from '../webchat-attachment/image-normalizer.ts'
import { AvatarServiceError, createSyncAvatarHandler, type AvatarSyncTarget } from './handler.ts'
import { fetchQqAvatar } from './qq-avatar.ts'

const BUCKET = 'member-avatars'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function singleRow(value: unknown, label: string): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label} returned invalid data`)
  }
  return row as Record<string, unknown>
}

function parseSyncTarget(value: unknown): AvatarSyncTarget {
  const row = singleRow(value, 'Avatar synchronization reservation')
  if (
    typeof row.profile_id !== 'string' ||
    (row.qq !== null && typeof row.qq !== 'string') ||
    typeof row.object_key !== 'string' ||
    (row.previous_object_key !== null && typeof row.previous_object_key !== 'string') ||
    (row.source_qq_sha256 !== null && typeof row.source_qq_sha256 !== 'string')
  ) {
    throw new Error('Avatar synchronization reservation returned invalid fields')
  }
  return {
    profileId: row.profile_id,
    qq: row.qq,
    objectKey: row.object_key,
    previousObjectKey: row.previous_object_key,
    sourceQqSha256: row.source_qq_sha256,
  }
}

async function authorizeTarget(
  client: SupabaseClient,
  token: string,
  serviceRoleKey: string,
  requestedMemberId: string | null,
): Promise<string> {
  if (token === serviceRoleKey || gatewayVerifiedJwtRole(token) === 'service_role') {
    if (!requestedMemberId) throw new AvatarServiceError('invalid_request')
    return requestedMemberId
  }

  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new AvatarServiceError('unauthorized')
  const actorId = data.user.id
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('role, review_status')
    .eq('id', actorId)
    .maybeSingle()
  if (profileError) throw new Error('Could not authorize avatar synchronization')
  if (profile?.review_status !== 'approved') {
    throw new AvatarServiceError('forbidden')
  }
  const targetId = requestedMemberId ?? actorId
  if (targetId !== actorId && profile.role !== 'admin') {
    throw new AvatarServiceError('forbidden')
  }
  return targetId
}

const handler = createSyncAvatarHandler({
  allowedOrigins: Deno.env.get('ALLOWED_ORIGIN'),
  createServices() {
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const serviceClient = createClient(requiredEnv('SUPABASE_URL'), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    return {
      authorizeTarget: (token, memberId) =>
        authorizeTarget(serviceClient, token, serviceRoleKey, memberId),
      async beginSync(profileId, ownerToken) {
        const { data, error } = await serviceClient.rpc('begin_member_avatar_sync', {
          requested_profile_id: profileId,
          requested_owner_token: ownerToken,
        })
        if (error?.code === '55006' || error?.code === '55000') {
          throw new AvatarServiceError('conflict')
        }
        if (error) throw new Error('Could not reserve avatar synchronization')
        return parseSyncTarget(data)
      },
      async renewSync(profileId, ownerToken) {
        const { data, error } = await serviceClient.rpc('renew_member_avatar_sync', {
          requested_profile_id: profileId,
          requested_owner_token: ownerToken,
        })
        if (error) throw new Error('Could not renew avatar synchronization')
        return data === true
      },
      async uploadObject(objectKey, bytes) {
        const { error } = await serviceClient.storage.from(BUCKET).upload(objectKey, bytes, {
          cacheControl: '86400',
          contentType: 'image/webp',
          upsert: false,
        })
        if (error) throw new Error('Could not store normalized member avatar')
      },
      async removeObject(objectKey) {
        const { error } = await serviceClient.storage.from(BUCKET).remove([objectKey])
        if (error) throw new Error('Could not remove member avatar')
      },
      async completeSync(profileId, ownerToken, objectKey, sha256, sourceQqSha256) {
        const { data, error } = await serviceClient.rpc('complete_member_avatar_sync', {
          requested_profile_id: profileId,
          requested_owner_token: ownerToken,
          requested_object_key: objectKey,
          requested_sha256: sha256,
          requested_source_qq_sha256: sourceQqSha256,
        })
        if (error || typeof data !== 'string') {
          throw new Error('Could not commit member avatar synchronization')
        }
        return data
      },
      async completeRemoval(profileId, ownerToken) {
        const { data, error } = await serviceClient.rpc('complete_member_avatar_removal', {
          requested_profile_id: profileId,
          requested_owner_token: ownerToken,
        })
        if (error || data !== true) throw new Error('Could not commit member avatar removal')
      },
      async failSync(profileId, ownerToken) {
        const { error } = await serviceClient.rpc('fail_member_avatar_sync', {
          requested_profile_id: profileId,
          requested_owner_token: ownerToken,
        })
        if (error) throw new Error('Could not release avatar synchronization')
      },
    }
  },
  fetchAvatar: fetchQqAvatar,
  async normalizeAvatar(image) {
    const normalized = await normalizeImage(image.bytes, image.mediaType)
    return { bytes: normalized.bytes, sha256: normalized.sha256 }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('sync-avatar', request, error))
  },
})

Deno.serve(handler)
