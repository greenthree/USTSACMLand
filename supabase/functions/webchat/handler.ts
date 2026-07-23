import { corsHeaders, resolveCorsOrigin } from '../_shared/cors.ts'
import {
  prepareWebChatQuota,
  type WebChatBudgetAlertClaim,
  type WebChatClaimResult,
  type WebChatQuotaPolicy,
  type WebChatUsage,
} from './quota.ts'
import {
  parseWebChatRequest,
  RequestValidationError,
  type NormalizedWebChatMessage,
} from './request.ts'
import type { WebChatRelayRuntimeConfig } from './runtime-config.ts'
import type { WebChatMemberRuntimeAccess } from './member-access.ts'
import {
  type StartWebChatOptions,
  type WebChatImage,
  type WebChatMessage,
  WebChatUpstreamError,
} from './upstream.ts'

export interface WebChatUser {
  id: string
}

export interface WebChatServices {
  getUser(token: string): Promise<WebChatUser | null>
  readMemberRuntimeAccess(userId: string): Promise<WebChatMemberRuntimeAccess>
  readRelayRuntimeConfig(): Promise<WebChatRelayRuntimeConfig>
  bindWebChatImageAttachments(input: {
    userId: string
    conversationId: string
    messageId: string
    attachmentIds: string[]
  }): Promise<number>
  readWebChatImageAttachmentForModel(input: {
    userId: string
    conversationId: string
    messageId: string
    attachmentId: string
  }): Promise<Omit<WebChatImage, 'attachmentId'> | null>
  claimWebChatRequest(input: {
    userId: string
    requestId: string
    fingerprint: string
    ownerToken: string
    reservedTokens: number
    minuteRequestLimit: number
    leaseSeconds: number
  }): Promise<WebChatClaimResult>
  claimWebChatBudgetAlert(input: {
    budgetKind: 'requests' | 'tokens'
    budgetLimit: number
    attemptedReservedTokens: number
  }): Promise<WebChatBudgetAlertClaim>
  notifyWebChatBudgetAlert(alert: WebChatBudgetAlertClaim): Promise<void>
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
  visionEnabled: boolean
  visionModel: string | null
  allowedOrigins: string
  maxBodyBytes?: number
  maxMessages?: number
  maxMessageChars?: number
  maxTotalChars?: number
  maxTotalImages?: number
  quotaPolicy: WebChatQuotaPolicy
  buildSystemPrompt(model: string): string
  createServices(): WebChatServices
  startChat(
    options: StartWebChatOptions,
    runtimeConfig: WebChatRelayRuntimeConfig,
    systemPrompt: string,
  ): Promise<Response>
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

async function reportSafely(
  dependencies: WebChatHandlerDependencies,
  request: Request,
  error: unknown,
): Promise<void> {
  try {
    await dependencies.reportUnexpectedError(request, error)
  } catch {
    // Monitoring is best-effort and must never replace the stable API response.
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function imageCount(messages: NormalizedWebChatMessage[]): number {
  return messages.reduce((count, message) => count + message.images.length, 0)
}

function assertImageRequestAllowed(
  messages: NormalizedWebChatMessage[],
  conversationId: string | null,
  visionEnabled: boolean,
): void {
  if (imageCount(messages) === 0) return
  requireImageConversationId(conversationId, visionEnabled)
}

function requireImageConversationId(conversationId: string | null, visionEnabled: boolean): string {
  if (!visionEnabled) {
    throw new ApiError(503, 'vision_not_enabled', '当前模型暂未开启图片理解')
  }
  if (!conversationId || !UUID_PATTERN.test(conversationId)) {
    throw new ApiError(400, 'invalid_request', '图片消息需要有效的历史会话')
  }
  return conversationId
}

function quotaMessages(messages: NormalizedWebChatMessage[]) {
  return messages.map(({ role, text, images }) => ({
    role,
    text,
    // Dimensions are deliberately unavailable before attachment lookup. The
    // quota estimator treats them as 2048x2048 so the preflight reservation
    // remains conservative without touching Storage or attachment metadata.
    images: images.map(({ attachmentId }) => ({ attachmentId })),
  }))
}

async function resolveImageMessages(
  messages: NormalizedWebChatMessage[],
  conversationId: string | null,
  userId: string,
  services: WebChatServices,
  visionEnabled: boolean,
): Promise<WebChatMessage[]> {
  if (imageCount(messages) === 0) {
    return messages.map(({ id, role, text }) => ({ id, role, text, images: [] }))
  }
  const persistedConversationId = requireImageConversationId(conversationId, visionEnabled)

  const resolved: WebChatMessage[] = []
  for (const message of messages) {
    if (message.images.length === 0) {
      resolved.push({ id: message.id, role: message.role, text: message.text, images: [] })
      continue
    }

    const attachmentIds = message.images.map((image) => image.attachmentId)
    const bound = await services.bindWebChatImageAttachments({
      userId,
      conversationId: persistedConversationId,
      messageId: message.id,
      attachmentIds,
    })
    if (bound !== attachmentIds.length) {
      throw new ApiError(409, 'image_not_attached', '图片尚未绑定到当前消息，请稍后再试')
    }

    const images: WebChatImage[] = []
    for (const image of message.images) {
      const modelImage = await services.readWebChatImageAttachmentForModel({
        userId,
        conversationId: persistedConversationId,
        messageId: message.id,
        attachmentId: image.attachmentId,
      })
      if (!modelImage) {
        throw new ApiError(409, 'image_not_attached', '图片尚未准备好，请稍后再试')
      }
      images.push({ attachmentId: image.attachmentId, ...modelImage })
    }
    resolved.push({ id: message.id, role: message.role, text: message.text, images })
  }
  return resolved
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
    case 'member_access_denied':
      return new ApiError(403, 'chat_access_denied', '当前账号尚未开通 AI 学习助手')
    case 'request_token_limited':
      return new ApiError(413, 'chat_request_token_limit', '当前对话内容过长，请缩短后重新发送')
    case 'requests_disabled':
      return new ApiError(503, 'chat_paused', 'AI 学习助手已由管理员暂停')
    case 'active_concurrent':
      return new ApiError(409, 'generation_in_progress', '已有一条 AI 回复正在生成', retryAfter)
    case 'minute_limited':
      return new ApiError(429, 'chat_minute_limited', '发送过于频繁，请稍后再试', retryAfter)
    case 'member_total_request_limited':
      return new ApiError(429, 'chat_total_request_limited', 'AI 助手累计请求次数已用完')
    case 'member_total_token_limited':
      return new ApiError(429, 'chat_total_token_limited', 'AI 助手累计 Token 额度已用完')
    case 'global_daily_request_limited':
      return new ApiError(
        503,
        'chat_global_request_budget_exhausted',
        '今日全站 AI 请求预算已用完',
        retryAfter,
      )
    case 'global_daily_token_limited':
      return new ApiError(
        503,
        'chat_global_token_budget_exhausted',
        '今日全站 AI 额度已用完',
        retryAfter,
      )
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
      const memberAccess = await services.readMemberRuntimeAccess(user.id)
      if (!memberAccess.accountEligible) {
        throw new ApiError(403, 'account_ineligible', '当前账号不能使用 AI 学习助手')
      }
      if (!memberAccess.enabled) {
        throw new ApiError(403, 'chat_access_denied', '当前账号尚未开通 AI 学习助手')
      }

      const runtimeConfig = await services.readRelayRuntimeConfig()
      if (!runtimeConfig.requestsEnabled) {
        throw new ApiError(503, 'chat_paused', 'AI 学习助手已由管理员暂停')
      }

      const body = await parseWebChatRequest(request, {
        maxBodyBytes: dependencies.maxBodyBytes,
        maxMessages: dependencies.maxMessages,
        maxMessageChars: dependencies.maxMessageChars,
        maxTotalChars: dependencies.maxTotalChars,
        maxTotalImages: dependencies.maxTotalImages,
      })
      const visionEnabledForCurrentModel =
        dependencies.visionEnabled &&
        dependencies.visionModel !== null &&
        dependencies.visionModel === runtimeConfig.model
      assertImageRequestAllowed(body.messages, body.chatId, visionEnabledForCurrentModel)
      const systemPrompt = dependencies.buildSystemPrompt(runtimeConfig.model)
      const requestQuotaPolicy = {
        ...dependencies.quotaPolicy,
        model: runtimeConfig.model,
        systemPrompt,
        memberTotalRequestLimit: memberAccess.totalRequestLimit,
        memberTotalTokenLimit: memberAccess.totalTokenLimit,
      }
      const quota = await prepareWebChatQuota(quotaMessages(body.messages), requestQuotaPolicy)
      if (quota.reservedTokens > requestQuotaPolicy.memberTotalTokenLimit) {
        throw new ApiError(413, 'chat_request_token_limit', '当前对话内容过长，请缩短后重新发送')
      }

      const ownerToken = crypto.randomUUID()
      const claim = await services.claimWebChatRequest({
        userId: user.id,
        requestId: currentRequestId,
        fingerprint: quota.fingerprint,
        ownerToken,
        reservedTokens: quota.reservedTokens,
        minuteRequestLimit: requestQuotaPolicy.minuteRequestLimit,
        leaseSeconds: requestQuotaPolicy.leaseSeconds,
      })
      if (claim.decision !== 'acquired') {
        const budgetKinds: Array<'requests' | 'tokens'> =
          claim.decision === 'global_daily_request_limited'
            ? ['requests']
            : claim.decision === 'global_daily_token_limited'
              ? ['tokens']
              : []
        for (const budgetKind of budgetKinds) {
          try {
            const alert = await services.claimWebChatBudgetAlert({
              budgetKind,
              budgetLimit:
                budgetKind === 'requests'
                  ? runtimeConfig.globalDailyRequestLimit
                  : runtimeConfig.globalDailyTokenLimit,
              attemptedReservedTokens: budgetKind === 'tokens' ? quota.reservedTokens : 0,
            })
            if (alert.shouldNotify) await services.notifyWebChatBudgetAlert(alert)
          } catch (alertError) {
            // Alerting is operational telemetry. A delivery or marker failure
            // must not turn a deterministic budget rejection into a 500.
            await reportSafely(dependencies, request, alertError)
          }
        }
        throw quotaError(claim)
      }

      try {
        const messages = await resolveImageMessages(
          body.messages,
          body.chatId,
          user.id,
          services,
          visionEnabledForCurrentModel,
        )
        const response = await dependencies.startChat(
          {
            messages,
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
          },
          runtimeConfig,
          systemPrompt,
        )
        return streamResponse(response, request, dependencies.allowedOrigins, currentRequestId)
      } catch (error) {
        try {
          const released = await services.releaseWebChatRequest(
            user.id,
            currentRequestId,
            ownerToken,
            'start_failed_before_upstream',
          )
          if (!released) {
            await reportSafely(
              dependencies,
              request,
              new Error('WebChat pre-start claim release was not applied.'),
            )
          }
        } catch (releaseError) {
          await reportSafely(dependencies, request, releaseError)
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

      await reportSafely(dependencies, request, error)
      return respond('internal_error', 'AI 学习助手暂时不可用，请稍后重试', 500)
    }
  }
}
