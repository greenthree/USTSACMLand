import { resolveCorsOrigin } from '../_shared/cors.ts'

export interface WebChatRelayConfigView {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  requestsEnabled: boolean
  globalDailyRequestLimit: number
  globalDailyTokenLimit: number
  version: number
  updatedAt: string
}

export interface WebChatGlobalBudgetUsageView {
  usageDate: string
  requestCount: number
  settledTokens: number
  reservedTokens: number
  resetAt: string
  requestBudgetAlertedAt: string | null
  tokenBudgetAlertedAt: string | null
}

export interface WebChatConfigUser {
  id: string
}

export interface WebChatConfigAdminState {
  role: string
  reviewStatus: string
}

export interface WebChatConfigUpdate {
  baseUrl: string
  model: string
  apiKey: string | null
  requestsEnabled: boolean
  globalDailyRequestLimit: number
  globalDailyTokenLimit: number
  expectedVersion: number
  reason: string
}

export interface WebChatConfigServices {
  getUser(token: string): Promise<WebChatConfigUser | null>
  getAdminState(userId: string): Promise<WebChatConfigAdminState | null>
  readConfig(): Promise<WebChatRelayConfigView>
  readBudgetUsage(): Promise<WebChatGlobalBudgetUsageView>
  updateConfig(userId: string, update: WebChatConfigUpdate): Promise<WebChatRelayConfigView>
}

export interface WebChatConfigHandlerDependencies {
  allowedOrigins: string
  maxBodyBytes?: number
  createServices(): WebChatConfigServices
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
}

export type WebChatConfigServiceErrorKind =
  'conflict' | 'rate_limited' | 'invalid_request' | 'forbidden'

export class WebChatConfigServiceError extends Error {
  constructor(
    readonly kind: WebChatConfigServiceErrorKind,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`WebChat configuration service error: ${kind}`)
    this.name = 'WebChatConfigServiceError'
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

type WebChatConfigAction = { action: 'read' } | { action: 'update'; update: WebChatConfigUpdate }

async function parseActionRequest(
  request: Request,
  maxBodyBytes: number,
): Promise<WebChatConfigAction> {
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
  if (body.action === 'read') {
    if (Object.keys(body).length !== 1) {
      throw new ApiError(400, 'invalid_request', '读取配置请求只能包含 action 字段')
    }
    return { action: 'read' }
  }
  if (body.action !== 'update') {
    throw new ApiError(400, 'invalid_request', '配置操作无效')
  }

  const allowedFields = new Set([
    'action',
    'baseUrl',
    'model',
    'apiKey',
    'requestsEnabled',
    'globalDailyRequestLimit',
    'globalDailyTokenLimit',
    'expectedVersion',
    'reason',
  ])
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new ApiError(400, 'invalid_request', '配置请求包含不支持的字段')
  }
  if (
    typeof body.baseUrl !== 'string' ||
    typeof body.model !== 'string' ||
    (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') ||
    typeof body.requestsEnabled !== 'boolean' ||
    typeof body.globalDailyRequestLimit !== 'number' ||
    !Number.isSafeInteger(body.globalDailyRequestLimit) ||
    typeof body.globalDailyTokenLimit !== 'number' ||
    !Number.isSafeInteger(body.globalDailyTokenLimit) ||
    typeof body.expectedVersion !== 'number' ||
    !Number.isSafeInteger(body.expectedVersion) ||
    body.expectedVersion < 0 ||
    typeof body.reason !== 'string'
  ) {
    throw new ApiError(400, 'invalid_request', '配置请求字段无效')
  }

  return {
    action: 'update',
    update: {
      baseUrl: body.baseUrl,
      model: body.model,
      apiKey: body.apiKey ?? null,
      requestsEnabled: body.requestsEnabled,
      globalDailyRequestLimit: body.globalDailyRequestLimit,
      globalDailyTokenLimit: body.globalDailyTokenLimit,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
    },
  }
}

function serviceError(error: WebChatConfigServiceError): ApiError {
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
  }
}

export function createWebChatConfigHandler(
  dependencies: WebChatConfigHandlerDependencies,
): (request: Request) => Promise<Response> {
  if (!dependencies.allowedOrigins.trim() || dependencies.allowedOrigins.trim() === '*') {
    throw new Error('WebChat configuration requires an explicit CORS origin allowlist')
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

      // This read is deliberately performed for every request. Auth custom
      // claims can lag behind a suspension or role handoff.
      const admin = await services.getAdminState(user.id)
      if (admin?.role !== 'admin' || admin.reviewStatus !== 'approved') {
        throw new ApiError(403, 'admin_required', '需要当前有效的管理员权限')
      }

      const action = await parseActionRequest(request, maxBodyBytes)
      let config: WebChatRelayConfigView
      let dailyUsage: WebChatGlobalBudgetUsageView
      if (action.action === 'read') {
        const [currentConfig, currentUsage] = await Promise.all([
          services.readConfig(),
          services.readBudgetUsage(),
        ])
        config = currentConfig
        dailyUsage = currentUsage
      } else {
        // Read monitoring state before the mutation so a usage RPC failure
        // cannot make a committed key rotation look like a failed update.
        dailyUsage = await services.readBudgetUsage()
        config = await services.updateConfig(user.id, action.update)
      }

      // Only this explicit redacted projection can reach the browser. The API
      // key is accepted on writes but is never represented in response types.
      return respond({ config: { ...config, dailyUsage } }, 200)
    } catch (error) {
      const mapped = error instanceof WebChatConfigServiceError ? serviceError(error) : error
      if (mapped instanceof ApiError) {
        return respond(
          { error: { code: mapped.code, message: mapped.message } },
          mapped.status,
          mapped.retryAfter,
        )
      }

      await dependencies.reportUnexpectedError(request, error)
      return respond(
        { error: { code: 'internal_error', message: 'WebChat 配置服务暂时不可用' } },
        500,
      )
    }
  }
}
