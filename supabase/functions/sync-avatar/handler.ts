import { corsHeaders, resolveCorsOrigin } from '../_shared/cors.ts'

interface SyncAvatarRequest {
  memberId?: string
}

export interface AvatarSyncTarget {
  profileId: string
  qq: string | null
  objectKey: string
  previousObjectKey: string | null
  sourceQqSha256: string | null
}

export interface AvatarImage {
  bytes: Uint8Array
  mediaType: string | null
}

export interface NormalizedAvatar {
  bytes: Uint8Array
  sha256: string
}

export interface SyncAvatarServices {
  authorizeTarget(token: string, requestedMemberId: string | null): Promise<string>
  beginSync(profileId: string, ownerToken: string): Promise<AvatarSyncTarget>
  renewSync(profileId: string, ownerToken: string): Promise<boolean>
  uploadObject(objectKey: string, bytes: Uint8Array): Promise<void>
  removeObject(objectKey: string): Promise<void>
  completeSync(
    profileId: string,
    ownerToken: string,
    objectKey: string,
    sha256: string,
    sourceQqSha256: string,
  ): Promise<string>
  completeRemoval(profileId: string, ownerToken: string): Promise<void>
  failSync(profileId: string, ownerToken: string): Promise<void>
}

export interface SyncAvatarHandlerDependencies {
  allowedOrigins?: string
  createServices(request: Request): SyncAvatarServices
  fetchAvatar(qq: string): Promise<AvatarImage>
  normalizeAvatar(image: AvatarImage): Promise<NormalizedAvatar>
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class AvatarServiceError extends Error {
  constructor(readonly kind: 'unauthorized' | 'forbidden' | 'invalid_request' | 'conflict') {
    super(kind)
    this.name = 'AvatarServiceError'
  }
}

function bearerToken(request: Request): string {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
  return match[1]
}

function requestedMemberId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError(400, 'invalid_member_id', '成员标识无效')
  }
  return value
}

async function parseRequest(request: Request): Promise<SyncAvatarRequest> {
  const body = await request.text()
  if (!body.trim()) return {}
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid')
    }
    const keys = Object.keys(parsed)
    if (keys.some((key) => key !== 'memberId')) throw new Error('invalid')
    return parsed as SyncAvatarRequest
  } catch {
    throw new ApiError(400, 'invalid_request', '头像同步请求无效')
  }
}

function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof AvatarServiceError) {
    if (error.kind === 'unauthorized') {
      return new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
    }
    if (error.kind === 'forbidden') {
      return new ApiError(403, 'avatar_sync_forbidden', '无权同步该成员头像')
    }
    if (error.kind === 'conflict') {
      return new ApiError(409, 'avatar_sync_limited', '头像正在同步或刚刚更新，请稍后再试')
    }
    return new ApiError(400, 'invalid_request', '头像同步请求无效')
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError(504, 'avatar_source_timeout', 'QQ 头像服务响应超时')
  }
  if (error instanceof Error && error.name === 'AvatarSourceError') {
    return new ApiError(502, 'avatar_source_unavailable', 'QQ 头像暂时无法获取')
  }
  if (error instanceof Error && error.name.includes('Image') && error.name.endsWith('Error')) {
    return new ApiError(502, 'avatar_image_invalid', 'QQ 头像返回了无效图片')
  }
  return new ApiError(500, 'avatar_sync_failed', '头像同步暂时不可用，请稍后重试')
}

export function createSyncAvatarHandler(
  dependencies: SyncAvatarHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const configuredOrigins = dependencies.allowedOrigins
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          ...corsHeaders(request, configuredOrigins),
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        },
      })

    const requestOrigin = request.headers.get('origin')
    if (requestOrigin && !resolveCorsOrigin(requestOrigin, configuredOrigins)) {
      return respond(
        { error: { code: 'origin_forbidden', message: '当前来源不允许访问此服务' } },
        403,
      )
    }
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders(request, configuredOrigins) })
    }
    if (request.method !== 'POST') {
      return respond({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, 405)
    }

    let target: AvatarSyncTarget | null = null
    let ownerToken: string | null = null
    let objectUploaded = false
    let syncCommitted = false
    let services: SyncAvatarServices | null = null
    try {
      const token = bearerToken(request)
      const body = await parseRequest(request)
      services = dependencies.createServices(request)
      const profileId = await services.authorizeTarget(token, requestedMemberId(body.memberId))
      ownerToken = crypto.randomUUID()
      target = await services.beginSync(profileId, ownerToken)

      if (!target.qq) {
        await services.completeRemoval(profileId, ownerToken)
        syncCommitted = true
        if (target.previousObjectKey) {
          try {
            await services.removeObject(target.previousObjectKey)
          } catch (cleanupError) {
            await dependencies.reportUnexpectedError(request, cleanupError)
          }
        }
        return respond({ avatarAvailable: false, updated: true })
      }
      if (!target.sourceQqSha256) {
        throw new ApiError(409, 'avatar_sync_conflict', '头像同步状态已变化，请重试')
      }

      const sourceImage = await dependencies.fetchAvatar(target.qq)
      const normalized = await dependencies.normalizeAvatar(sourceImage)
      if (!(await services.renewSync(profileId, ownerToken))) {
        throw new ApiError(409, 'avatar_sync_conflict', '头像同步状态已变化，请重试')
      }
      await services.uploadObject(target.objectKey, normalized.bytes)
      objectUploaded = true
      const updatedAt = await services.completeSync(
        profileId,
        ownerToken,
        target.objectKey,
        normalized.sha256,
        target.sourceQqSha256,
      )
      syncCommitted = true
      if (target.previousObjectKey && target.previousObjectKey !== target.objectKey) {
        try {
          await services.removeObject(target.previousObjectKey)
        } catch (cleanupError) {
          await dependencies.reportUnexpectedError(request, cleanupError)
        }
      }
      return respond({ avatarAvailable: true, updated: true, updatedAt })
    } catch (error) {
      if (target && ownerToken && services) {
        if (objectUploaded && !syncCommitted) {
          try {
            await services.removeObject(target.objectKey)
          } catch (cleanupError) {
            await dependencies.reportUnexpectedError(request, cleanupError)
          }
        }
        try {
          await services.failSync(target.profileId, ownerToken)
        } catch (cleanupError) {
          await dependencies.reportUnexpectedError(request, cleanupError)
        }
      }

      const mapped = publicError(error)
      if (mapped.code === 'avatar_sync_failed') {
        await dependencies.reportUnexpectedError(request, error)
      }
      return respond({ error: { code: mapped.code, message: mapped.message } }, mapped.status)
    }
  }
}
