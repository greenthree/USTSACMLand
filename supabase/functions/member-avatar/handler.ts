export interface PublicMemberAvatar {
  avatarPath: string | null
  avatarUpdatedAt: string | null
}

export interface MemberAvatarServices {
  readVisibleAvatar(memberId: string): Promise<PublicMemberAvatar | null>
  downloadAvatar(objectKey: string): Promise<ArrayBuffer>
}

export interface MemberAvatarHandlerDependencies {
  createServices(): MemberAvatarServices
  reportUnexpectedError(request: Request, error: unknown): Promise<void> | void
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage)
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const versionPattern = /^[0-9A-Za-z.:+-]{1,64}$/

function responseHeaders(contentType: string): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'cache-control': 'no-store',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  }
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: responseHeaders('application/json; charset=utf-8'),
  })
}

function parseMemberId(request: Request): string {
  if (request.url.length > 1_024) {
    throw new ApiError(400, 'Invalid avatar request')
  }

  const url = new URL(request.url)
  for (const key of url.searchParams.keys()) {
    if (key !== 'memberId' && key !== 'v') {
      throw new ApiError(400, 'Invalid avatar request')
    }
  }

  const memberIds = url.searchParams.getAll('memberId')
  const versions = url.searchParams.getAll('v')
  if (memberIds.length !== 1 || !uuidPattern.test(memberIds[0])) {
    throw new ApiError(400, 'Invalid member ID')
  }
  if (versions.length > 1 || (versions.length === 1 && !versionPattern.test(versions[0]))) {
    throw new ApiError(400, 'Invalid avatar version')
  }
  return memberIds[0].toLowerCase()
}

export function createMemberAvatarHandler(
  dependencies: MemberAvatarHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders('text/plain') })
    }
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405)
    }

    try {
      const memberId = parseMemberId(request)
      const services = dependencies.createServices()
      const avatar = await services.readVisibleAvatar(memberId)
      if (!avatar?.avatarPath || !avatar.avatarUpdatedAt) {
        throw new ApiError(404, 'Avatar not found')
      }

      const expectedObjectKey = new RegExp(
        `^member/${memberId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.webp$`,
        'i',
      )
      if (!expectedObjectKey.test(avatar.avatarPath)) {
        throw new Error('Public member avatar path did not match its member')
      }

      const image = await services.downloadAvatar(avatar.avatarPath)
      if (image.byteLength === 0) {
        throw new Error('Member avatar object was empty')
      }
      return new Response(image, {
        status: 200,
        headers: responseHeaders('image/webp'),
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error.publicMessage, error.status)
      }
      await dependencies.reportUnexpectedError(request, error)
      return errorResponse('Avatar temporarily unavailable', 503)
    }
  }
}
