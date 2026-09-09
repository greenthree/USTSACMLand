import { resolveCorsOrigin } from '../_shared/cors.ts'

export interface AuthCaptchaConfigView {
  enabled: boolean
  version: number
  updatedAt: string
}

export interface AuthCaptchaConfigUpdate {
  enabled: boolean
  expectedVersion: number
  reason: string
}

export interface AuthCaptchaConfigUser {
  id: string
}

export interface AuthCaptchaConfigAdminState {
  role: string
  reviewStatus: string
}

export interface AuthCaptchaConfigServices {
  getUser(token: string): Promise<AuthCaptchaConfigUser | null>
  getAdminState(userId: string): Promise<AuthCaptchaConfigAdminState | null>
  readConfig(): Promise<AuthCaptchaConfigView>
  updateConfig(userId: string, update: AuthCaptchaConfigUpdate): Promise<AuthCaptchaConfigView>
}

export interface AuthCaptchaConfigHandlerDependencies {
  allowedOrigins: string
  maxBodyBytes?: number
  createServices(): AuthCaptchaConfigServices
}

export type AuthCaptchaConfigServiceErrorKind =
  'conflict' | 'rate_limited' | 'invalid_request' | 'forbidden' | 'management_unavailable'

export class AuthCaptchaConfigServiceError extends Error {
  constructor(
    readonly kind: AuthCaptchaConfigServiceErrorKind,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Auth CAPTCHA configuration service error: ${kind}`)
    this.name = 'AuthCaptchaConfigServiceError'
  }
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter: string | null = null,
  ) {
    super(message)
  }
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim()
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID()
}

function bearerToken(request: Request): string {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new ApiError(401, 'unauthorized', '请先登录管理员账号')
  return match[1]
}

function responseHeaders(
  request: Request,
  allowedOrigins: string,
  currentRequestId: string,
): Record<string, string> {
  const allowedOrigin = resolveCorsOrigin(request.headers.get('origin'), allowedOrigins)
  return {
    ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
    ...(allowedOrigin && allowedOrigin !== '*' ? { vary: 'Origin' } : {}),
    'access-control-allow-headers':
      'authorization, apikey, content-type, x-client-info, x-request-id',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'retry-after, x-request-id',
    'cache-control': 'private, no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': currentRequestId,
  }
}

function originAllowed(request: Request, configuredOrigins: string): boolean {
  const origin = request.headers.get('origin')
  return !origin || resolveCorsOrigin(origin, configuredOrigins) !== null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

async function parseUpdate(
  request: Request,
  maxBodyBytes: number,
): Promise<AuthCaptchaConfigUpdate> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new ApiError(413, 'request_too_large', '配置请求内容过大')
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > maxBodyBytes) {
    throw new ApiError(413, 'request_too_large', '配置请求内容过大')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ApiError(400, 'invalid_request', '配置请求不是有效的 JSON')
  }
  const body = asRecord(parsed)
  if (!body) throw new ApiError(400, 'invalid_request', '配置请求格式无效')
  const fields = new Set(['enabled', 'expectedVersion', 'reason'])
  if (Object.keys(body).some((field) => !fields.has(field))) {
    throw new ApiError(400, 'invalid_request', '配置请求包含不支持的字段')
  }
  if (
    typeof body.enabled !== 'boolean' ||
    typeof body.expectedVersion !== 'number' ||
    !Number.isSafeInteger(body.expectedVersion) ||
    body.expectedVersion < 0 ||
    typeof body.reason !== 'string' ||
    body.reason.trim().length < 3 ||
    body.reason.trim().length > 500
  ) {
    throw new ApiError(400, 'invalid_request', 'Auth CAPTCHA 配置请求字段无效')
  }
  return {
    enabled: body.enabled,
    expectedVersion: body.expectedVersion,
    reason: body.reason.trim(),
  }
}

function serviceError(error: AuthCaptchaConfigServiceError): ApiError {
  switch (error.kind) {
    case 'conflict':
      return new ApiError(409, 'config_conflict', '配置已被其他管理员修改，请刷新后重试')
    case 'rate_limited':
      return new ApiError(
        429,
        'admin_rate_limited',
        '配置修改过于频繁，请稍后重试',
        String(error.retryAfterSeconds ?? 60),
      )
    case 'invalid_request':
      return new ApiError(400, 'invalid_request', '配置内容无效，请检查后重试')
    case 'forbidden':
      return new ApiError(403, 'admin_required', '需要当前有效的管理员权限')
    case 'management_unavailable':
      return new ApiError(
        503,
        'management_unavailable',
        'Supabase Auth 配置服务暂时不可用，保护状态未改变',
      )
  }
}

export function createAuthCaptchaConfigHandler(
  dependencies: AuthCaptchaConfigHandlerDependencies,
): (request: Request) => Promise<Response> {
  if (!dependencies.allowedOrigins.trim() || dependencies.allowedOrigins.trim() === '*') {
    throw new Error('Auth CAPTCHA configuration requires an explicit CORS origin allowlist')
  }
  const maxBodyBytes = dependencies.maxBodyBytes ?? 8_192

  return async (request) => {
    const currentRequestId = requestId(request)
    const respond = (body: unknown, status: number, retryAfter: string | null = null): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          ...responseHeaders(request, dependencies.allowedOrigins, currentRequestId),
          ...(retryAfter ? { 'retry-after': retryAfter } : {}),
        },
      })

    if (!originAllowed(request, dependencies.allowedOrigins)) {
      return respond(
        { error: { code: 'origin_forbidden', message: '当前来源不允许访问此服务' } },
        403,
      )
    }
    if (request.method === 'OPTIONS') {
      return new Response('ok', {
        headers: responseHeaders(request, dependencies.allowedOrigins, currentRequestId),
      })
    }

    try {
      const services = dependencies.createServices()
      if (request.method === 'GET') {
        return respond({ config: await services.readConfig() }, 200)
      }
      if (request.method !== 'POST') {
        return respond(
          { error: { code: 'method_not_allowed', message: 'Method not allowed' } },
          405,
        )
      }

      const token = bearerToken(request)
      const user = await services.getUser(token)
      if (!user) throw new ApiError(401, 'unauthorized', '当前登录状态无效，请重新登录')
      const admin = await services.getAdminState(user.id)
      if (!admin || admin.role !== 'admin' || admin.reviewStatus !== 'approved') {
        throw new ApiError(403, 'admin_required', '需要当前有效的管理员权限')
      }
      const update = await parseUpdate(request, maxBodyBytes)
      return respond({ config: await services.updateConfig(user.id, update) }, 200)
    } catch (error) {
      if (error instanceof ApiError)
        return respond(
          { error: { code: error.code, message: error.message } },
          error.status,
          error.retryAfter,
        )
      if (error instanceof AuthCaptchaConfigServiceError) {
        const mapped = serviceError(error)
        return respond(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status,
          mapped.retryAfter,
        )
      }
      return respond(
        { error: { code: 'internal_error', message: 'Auth CAPTCHA 配置服务暂时不可用' } },
        503,
      )
    }
  }
}
