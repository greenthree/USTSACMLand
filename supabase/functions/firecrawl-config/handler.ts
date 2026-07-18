import { resolveCorsOrigin } from '../_shared/cors.ts'

export interface FirecrawlKeyView {
  id: string
  label: string
  keyConfigured: boolean
  enabled: boolean
  priority: number
  healthStatus:
    'unknown' | 'healthy' | 'warning' | 'critical' | 'degraded' | 'rate_limited' | 'auth_failed'
  consecutiveFailures: number
  cooldownUntil: string | null
  lastSelectedAt: string | null
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastErrorCode: string | null
  creditsRemaining: number | null
  creditsTotal: number | null
  billingPeriodEnd: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface FirecrawlKeyUpdate {
  keyId: string | null
  label: string
  apiKey: string | null
  enabled: boolean
  priority: number
  expectedVersion: number | null
  reason: string
}

export interface FirecrawlConfigServices {
  getUser(token: string): Promise<{ id: string } | null>
  getAdminState(userId: string): Promise<{ role: string; reviewStatus: string } | null>
  listKeys(userId: string): Promise<FirecrawlKeyView[]>
  upsertKey(userId: string, update: FirecrawlKeyUpdate): Promise<FirecrawlKeyView>
  deleteKey(userId: string, keyId: string, expectedVersion: number, reason: string): Promise<string>
  checkKey(
    userId: string,
    keyId: string,
  ): Promise<{ key: FirecrawlKeyView; succeeded: boolean; errorCode: string | null }>
}

export interface FirecrawlConfigHandlerDependencies {
  allowedOrigins: string
  maxBodyBytes?: number
  createServices(): FirecrawlConfigServices
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
}

export type FirecrawlConfigServiceErrorKind =
  'conflict' | 'rate_limited' | 'invalid_request' | 'forbidden' | 'not_found'

export class FirecrawlConfigServiceError extends Error {
  constructor(
    readonly kind: FirecrawlConfigServiceErrorKind,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Firecrawl configuration service error: ${kind}`)
    this.name = 'FirecrawlConfigServiceError'
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    'access-control-allow-methods': 'POST, OPTIONS',
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

type Action =
  | { action: 'read' }
  | { action: 'upsert'; update: FirecrawlKeyUpdate }
  | { action: 'delete'; keyId: string; expectedVersion: number; reason: string }
  | { action: 'check'; keyId: string }

async function parseAction(request: Request, maxBodyBytes: number): Promise<Action> {
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
  if (!body || typeof body.action !== 'string') {
    throw new ApiError(400, 'invalid_request', '配置请求格式无效')
  }

  if (body.action === 'read') {
    if (Object.keys(body).length !== 1) {
      throw new ApiError(400, 'invalid_request', '读取请求只能包含 action 字段')
    }
    return { action: 'read' }
  }
  if (body.action === 'check') {
    if (Object.keys(body).some((field) => !['action', 'keyId'].includes(field))) {
      throw new ApiError(400, 'invalid_request', '健康检查请求包含不支持的字段')
    }
    if (typeof body.keyId !== 'string' || !UUID_PATTERN.test(body.keyId)) {
      throw new ApiError(400, 'invalid_request', 'Firecrawl Key ID 无效')
    }
    return { action: 'check', keyId: body.keyId }
  }
  if (body.action === 'delete') {
    if (
      Object.keys(body).some(
        (field) => !['action', 'keyId', 'expectedVersion', 'reason'].includes(field),
      ) ||
      typeof body.keyId !== 'string' ||
      !UUID_PATTERN.test(body.keyId) ||
      typeof body.expectedVersion !== 'number' ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0 ||
      typeof body.reason !== 'string'
    ) {
      throw new ApiError(400, 'invalid_request', '删除请求字段无效')
    }
    return {
      action: 'delete',
      keyId: body.keyId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
    }
  }
  if (body.action !== 'upsert') {
    throw new ApiError(400, 'invalid_request', '配置操作无效')
  }

  const allowedFields = new Set([
    'action',
    'keyId',
    'label',
    'apiKey',
    'enabled',
    'priority',
    'expectedVersion',
    'reason',
  ])
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new ApiError(400, 'invalid_request', '配置请求包含不支持的字段')
  }
  if (
    (body.keyId !== null && typeof body.keyId !== 'string') ||
    (typeof body.keyId === 'string' && !UUID_PATTERN.test(body.keyId)) ||
    typeof body.label !== 'string' ||
    (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') ||
    typeof body.enabled !== 'boolean' ||
    typeof body.priority !== 'number' ||
    !Number.isSafeInteger(body.priority) ||
    (body.expectedVersion !== null &&
      (typeof body.expectedVersion !== 'number' ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 0)) ||
    typeof body.reason !== 'string'
  ) {
    throw new ApiError(400, 'invalid_request', '配置请求字段无效')
  }
  return {
    action: 'upsert',
    update: {
      keyId: body.keyId ?? null,
      label: body.label,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : null,
      enabled: body.enabled,
      priority: body.priority,
      expectedVersion: body.expectedVersion ?? null,
      reason: body.reason,
    },
  }
}

function mapServiceError(error: FirecrawlConfigServiceError): ApiError {
  switch (error.kind) {
    case 'conflict':
      return new ApiError(409, 'config_conflict', '配置已被其他管理员修改，请刷新后重试')
    case 'rate_limited':
      return new ApiError(
        429,
        'admin_rate_limited',
        '配置操作过于频繁，请稍后重试',
        String(error.retryAfterSeconds ?? 60),
      )
    case 'invalid_request':
      return new ApiError(400, 'invalid_request', '配置内容无效，请检查后重试')
    case 'forbidden':
      return new ApiError(403, 'admin_required', '需要当前有效的管理员权限')
    case 'not_found':
      return new ApiError(404, 'key_not_found', 'Firecrawl Key 不存在或密钥已丢失')
  }
}

export function createFirecrawlConfigHandler(
  dependencies: FirecrawlConfigHandlerDependencies,
): (request: Request) => Promise<Response> {
  if (!dependencies.allowedOrigins.trim() || dependencies.allowedOrigins.trim() === '*') {
    throw new Error('Firecrawl configuration requires an explicit CORS origin allowlist')
  }
  const maxBodyBytes = dependencies.maxBodyBytes ?? 16_384

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
    if (request.method !== 'POST') {
      return respond({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, 405)
    }

    try {
      const token = bearerToken(request)
      const services = dependencies.createServices()
      const user = await services.getUser(token)
      if (!user) throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
      const admin = await services.getAdminState(user.id)
      if (admin?.role !== 'admin' || admin.reviewStatus !== 'approved') {
        throw new ApiError(403, 'admin_required', '需要当前有效的管理员权限')
      }

      const action = await parseAction(request, maxBodyBytes)
      if (action.action === 'read') {
        return respond({ keys: await services.listKeys(user.id) }, 200)
      }
      if (action.action === 'upsert') {
        return respond({ key: await services.upsertKey(user.id, action.update) }, 200)
      }
      if (action.action === 'delete') {
        const deletedKeyId = await services.deleteKey(
          user.id,
          action.keyId,
          action.expectedVersion,
          action.reason,
        )
        return respond({ deletedKeyId }, 200)
      }
      return respond({ check: await services.checkKey(user.id, action.keyId) }, 200)
    } catch (error) {
      const mapped = error instanceof FirecrawlConfigServiceError ? mapServiceError(error) : error
      if (mapped instanceof ApiError) {
        return respond(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status,
          mapped.retryAfter,
        )
      }
      await dependencies.reportUnexpectedError(request, error)
      return respond(
        { error: { code: 'internal_error', message: 'Firecrawl 配置服务暂时不可用' } },
        500,
      )
    }
  }
}
