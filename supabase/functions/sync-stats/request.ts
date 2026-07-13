import { PLATFORM_IDS, type PlatformId } from '../_shared/adapters/index.ts'

export type SyncScope = 'all' | 'platform' | 'platforms' | 'member'

export interface SyncRequest {
  scope?: SyncScope
  platform?: PlatformId
  platforms?: PlatformId[]
  member_id?: string
}

export interface NormalizedSyncRequest {
  scope: SyncScope
  platforms?: PlatformId[]
  memberId?: string
}

export class SyncRequestError extends Error {}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function normalizePlatforms(value: unknown): PlatformId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SyncRequestError('platforms must be a non-empty array')
  }

  const unique = [...new Set(value)]
  if (
    unique.some(
      (platform) => typeof platform !== 'string' || !PLATFORM_IDS.includes(platform as PlatformId),
    )
  ) {
    throw new SyncRequestError('platforms contains an unsupported platform')
  }
  return unique as PlatformId[]
}

export function normalizeSyncRequest(body: SyncRequest): NormalizedSyncRequest {
  const scope = body.scope ?? 'all'
  if (!['all', 'platform', 'platforms', 'member'].includes(scope)) {
    throw new SyncRequestError('Unsupported scope')
  }

  if (scope === 'platform') {
    if (!PLATFORM_IDS.includes(body.platform as PlatformId)) {
      throw new SyncRequestError('A supported platform is required for platform scope')
    }
    return { scope, platforms: [body.platform as PlatformId] }
  }

  if (scope === 'platforms') {
    return { scope, platforms: normalizePlatforms(body.platforms) }
  }

  if (scope === 'member') {
    if (!isUuid(body.member_id)) {
      throw new SyncRequestError('A valid member_id is required for member scope')
    }
    return { scope, memberId: body.member_id }
  }

  return { scope }
}
