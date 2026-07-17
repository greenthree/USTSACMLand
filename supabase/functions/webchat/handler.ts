import { corsHeaders, resolveCorsOrigin } from '../_shared/cors.ts'
import {
  prepareWebChatQuota,
  type WebChatClaimResult,
  type WebChatQuotaPolicy,
  type WebChatUsage,
} from './quota.ts'
import { parseWebChatRequest, RequestValidationError } from './request.ts'
import { type StartWebChatOptions, WebChatUpstreamError } from './upstream.ts'

export interface WebChatUser {
  id: string
}

export interface WebChatServices {
  getUser(token: string): Promise<WebChatUser | null>
  isProfileApproved(userId: string): Promise<boolean>
  claimWebChatRequest(input: {
    userId: string
    requestId: string
    fingerprint: string
    ownerToken: string
    reservedTokens: number
    policy: WebChatQuotaPolicy
  }): Promise<WebChatClaimResult>
  markWebChatRequestStarted(userId: string, requestId: string, ownerToken: string): Promise<boolean>
  finalizeWebChatRequest(
    userId: string,
    requestId: string,
    ownerToken: string,
    outcome: string,
    usage: WebChatUsage | null,
  ): Promise<boolean>
  releaseWebChatRequest(
    userId: string,
    requestId: string,
    ownerToken: string,
    reason: string,
  ): Promise<boolean>
}

export interface WebChatHandlerDependencies {
  enabled: boolean
  allowedOrigins: string
  maxBodyBytes?: number
  maxMessages?: number
  maxMessageChars?: number
  maxTotalChars?: number
  quotaPolicy: WebChatQuotaPolicy
  createServices(): WebChatServices
  startChat(options: StartWebChatOptions): Promise<Response>
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
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

function bearerToken(request: Request): string {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+([^\s]+)$/i)
  if (!match) {
    throw new ApiError(401, 'unauthorized', '请先登录后再使用 AI 学习助手')
  }
  return match[1]
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim()
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID()
}

function originAllowed(request: Request, configuredOrigins: string): boolean {
  const origin = request.headers.get('origin')
  return !origin || resolveCorsOrigin(origin, configuredOrigins) !== null
}

function quotaError(result: WebChatClaimResult): ApiError {
  const retryAfter = result.retryAfterSeconds === null ? null : String(result.retryAfterSeconds)
  switch (result.decision) {
    case 'active_concurrent':
      return new ApiError(409, 'generation_in_progress', '已有一条 AI 回复正在生成', retryAfter)
    case 'minute_limited':
      return new ApiError(429, 'chat_minute_limited', '发送过于频繁，请稍后再试', retryAfter)
    case 'daily_request_limited':
      return new ApiError(
        429,
        'chat_daily_request_limited',
        '今日 AI 助手请求次数已用完',
        retryAfter,
      )
    case 'daily_token_limited':
      return new ApiError(429, 'chat_daily_token_limited', '今日 AI 助手额度已用完', retryAfter)
    case 'idempotency_conflict':
      return new ApiError(409, 'request_id_conflict', '请求标识已用于不同内容，请重新发送')
    case 'duplicate_active':
      return new ApiError(409, 'duplicate_request_active', '这条请求正在处理中', retryAfter)
    case 'duplicate_terminal':
      return new ApiError(409, 'duplicate_request', '这条请求已经处理过，请勿重复发送')
    case 'acquired':
      throw new Error('Acquired quota cannot be converted to an API error')
  }
}

function streamResponse(
  response: Response,
  request: Request,
  allowedOrigins: string,
  currentRequestId: string,
): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(corsHeaders(request, allowedOrigins))) {
    headers.set(name, value)
  }
  headers.set('cache-control', 'private, no-store, no-transform')
  headers.set(
    'access-control-expose-headers',
    'retry-after, x-request-id, x-usts-chat-prompt-version',
  )
  headers.set('x-request-id', currentRequestId)
  return new Response(response.body, { status: response.status, headers })
}

export function createWebChatHandler(
  dependencies: WebChatHandlerDependencies,
): (request: Request) => Promise<Response> {
  if (!dependencies.allowedOrigins.trim() || dependencies.allowedOrigins.trim() === '*') {
    throw new Error('WebChat requires an explicit CORS origin allowlist')
  }

  return async (request) => {
    const currentRequestId = requestId(request)
    const respond = (
      code: string,
      message: string,
      status: number,
      retryAfter: string | null = null,
    ) =>
      new Response(
        JSON.stringify({
          error: { code, message },
          requestId: currentRequestId,
        }),
        {
          status,
          headers: {
            ...corsHeaders(request, dependencies.allowedOrigins),
            'access-control-expose-headers':
              'retry-after, x-request-id, x-usts-chat-prompt-version',
            'cache-control': 'private, no-store',
            'content-type': 'application/json; charset=utf-8',
            'x-request-id': currentRequestId,
            ...(retryAfter ? { 'retry-after': retryAfter } : {}),
          },
        },
      )

    if (!originAllowed(request, dependencies.allowedOrigins)) {
      return respond('origin_forbidden', '当前来源不允许访问此服务', 403)
    }
    if (request.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          ...corsHeaders(request, dependencies.allowedOrigins),
          'x-request-id': currentRequestId,
        },
      })
    }
    if (request.method !== 'POST') {
      return respond('method_not_allowed', 'Method not allowed', 405)
    }
    if (!dependencies.enabled) {
      return respond('chat_disabled', 'AI 学习助手尚未开放', 503)
    }

    try {
      const token = bearerToken(request)
      const services = dependencies.createServices()
      const user = await services.getUser(token)
      if (!user) {
        throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
      }
      if (!(await services.isProfileApproved(user.id))) {
        throw new ApiError(403, 'account_ineligible', '当前账号不能使用 AI 学习助手')
      }

      const body = await parseWebChatRequest(request, {
        maxBodyBytes: dependencies.maxBodyBytes,
        maxMessages: dependencies.maxMessages,
        maxMessageChars: dependencies.maxMessageChars,
        maxTotalChars: dependencies.maxTotalChars,
      })
      const quota = await prepareWebChatQuota(body.messages, dependencies.quotaPolicy)
      if (quota.reservedTokens > dependencies.quotaPolicy.dailyTokenLimit) {
        throw new ApiError(413, 'chat_request_token_limit', '当前对话内容过长，请缩短后重新发送')
      }

      const ownerToken = crypto.randomUUID()
      const claim = await services.claimWebChatRequest({
        userId: user.id,
        requestId: currentRequestId,
        fingerprint: quota.fingerprint,
        ownerToken,
        reservedTokens: quota.reservedTokens,
        policy: dependencies.quotaPolicy,
      })
      if (claim.decision !== 'acquired') throw quotaError(claim)

      try {
        const response = await dependencies.startChat({
          messages: body.messages,
          userId: user.id,
          requestSignal: request.signal,
          requestId: currentRequestId,
          quotaLifecycle: {
            markStarted: () =>
              services.markWebChatRequestStarted(user.id, currentRequestId, ownerToken),
            finalize: (outcome, usage) =>
              services.finalizeWebChatRequest(
                user.id,
                currentRequestId,
                ownerToken,
                outcome,
                usage,
              ),
          },
          reportUnexpectedError: (error) => dependencies.reportUnexpectedError(request, error),
        })
        return streamResponse(response, request, dependencies.allowedOrigins, currentRequestId)
      } catch (error) {
        try {
          await services.releaseWebChatRequest(
            user.id,
            currentRequestId,
            ownerToken,
            'start_failed_before_upstream',
          )
        } catch (releaseError) {
          await dependencies.reportUnexpectedError(request, releaseError)
        }
        throw error
      }
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return respond(error.code, error.message, error.status)
      }
      if (error instanceof WebChatUpstreamError) {
        return respond(error.code, error.message, error.status, error.retryAfter)
      }
      if (error instanceof ApiError) {
        return respond(error.code, error.message, error.status, error.retryAfter)
      }

      await dependencies.reportUnexpectedError(request, error)
      return respond('internal_error', 'AI 学习助手暂时不可用，请稍后重试', 500)
    }
  }
}
