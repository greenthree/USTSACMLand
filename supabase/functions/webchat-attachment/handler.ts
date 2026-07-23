import { resolveCorsOrigin } from '../_shared/cors.ts'
import { ImageInspectionError, type InspectedImage } from './image-format.ts'
import { ImageNormalizationError } from './image-normalizer.ts'
import { AttachmentRequestError, parseAttachmentRequest } from './request.ts'

export interface AttachmentMemberAccess {
  accountEligible: boolean
  enabled: boolean
}

export interface NormalizedAttachmentImage {
  bytes: Uint8Array<ArrayBuffer>
  width: number
  height: number
  mediaType: 'image/webp'
  sha256: string
}

export interface AttachmentReservation {
  attachmentId: string
  objectKey: string
  expiresAt: string
}

export interface AttachmentPreview {
  attachmentId: string
  objectKey: string
  mediaType: 'image/webp'
  width: number
  height: number
  byteSize: number
  status: 'ready' | 'attached'
}

export type AttachmentServiceErrorKind =
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'quota_exceeded'
  | 'account_frozen'
  | 'invalid_request'
  | 'global_upload_rate_limit'
  | 'global_upload_byte_budget'
  | 'global_storage_capacity'
  | 'global_validation_concurrency'
  | 'global_uploads_paused'

export class AttachmentServiceError extends Error {
  constructor(readonly kind: AttachmentServiceErrorKind) {
    super(`Attachment service error: ${kind}`)
    this.name = 'AttachmentServiceError'
  }
}

export interface AttachmentServices {
  getUser(token: string): Promise<{ id: string } | null>
  readMemberAccess(userId: string): Promise<AttachmentMemberAccess>
  reserveAttachment(input: {
    userId: string
    conversationId: string
    attachmentId: string
    originalByteSize: number
    sourceMediaType: string
    sourceWidth: number
    sourceHeight: number
  }): Promise<AttachmentReservation>
  markValidating(userId: string, attachmentId: string, ownerToken: string): Promise<boolean>
  renewValidation(userId: string, attachmentId: string, ownerToken: string): Promise<boolean>
  completeAttachment(input: {
    userId: string
    attachmentId: string
    ownerToken: string
    objectKey: string
    byteSize: number
    width: number
    height: number
    sha256: string
  }): Promise<AttachmentPreview>
  failAttachment(input: {
    userId: string
    attachmentId: string
    ownerToken: string
    reason: string
  }): Promise<void>
  readPreview(userId: string, attachmentId: string): Promise<AttachmentPreview>
  queueRemoval(userId: string, attachmentId: string): Promise<boolean>
  uploadObject(objectKey: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
  deleteObject(objectKey: string): Promise<void>
  signPreview(objectKey: string, expiresInSeconds: number): Promise<string>
}

export interface AttachmentHandlerDependencies {
  enabled: boolean
  allowedOrigins: string
  previewTtlSeconds?: number
  normalizeImage(image: InspectedImage & { bytes: Uint8Array }): Promise<NormalizedAttachmentImage>
  createServices(): AttachmentServices
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
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
  if (!match) throw new ApiError(401, 'unauthorized', '请先登录后再上传图片')
  return match[1]
}

function originAllowed(request: Request, configuredOrigins: string): boolean {
  const origin = request.headers.get('origin')
  return !origin || resolveCorsOrigin(origin, configuredOrigins) !== null
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

function mapServiceError(error: AttachmentServiceError): ApiError {
  switch (error.kind) {
    case 'forbidden':
      return new ApiError(403, 'attachment_forbidden', '当前账号不能访问该图片')
    case 'not_found':
      return new ApiError(404, 'attachment_not_found', '图片不存在或已删除')
    case 'conflict':
      return new ApiError(409, 'attachment_conflict', '图片状态已变化，请刷新后重试')
    case 'quota_exceeded':
      return new ApiError(409, 'attachment_limit_reached', '当前会话待处理图片已达到上限')
    case 'account_frozen':
      return new ApiError(409, 'attachment_account_frozen', '账号正在注销，不能继续上传图片')
    case 'invalid_request':
      return new ApiError(400, 'invalid_request', '图片请求无效')
    case 'global_upload_rate_limit':
      return new ApiError(429, 'attachment_global_rate_limited', '当前图片上传请求较多，请稍后重试')
    case 'global_upload_byte_budget':
      return new ApiError(
        429,
        'attachment_global_byte_budget_reached',
        '当前图片上传流量较大，请稍后重试',
      )
    case 'global_storage_capacity':
      return new ApiError(
        503,
        'attachment_storage_capacity_reached',
        '图片存储服务暂时不可用，请稍后重试',
      )
    case 'global_validation_concurrency':
      return new ApiError(503, 'attachment_processing_busy', '图片处理服务繁忙，请稍后重试', 30)
    case 'global_uploads_paused':
      return new ApiError(503, 'attachment_uploads_paused', '图片上传服务暂时不可用，请稍后重试')
  }
}

function imageError(error: ImageInspectionError): ApiError {
  const status = error.code === 'image_too_large' ? 413 : 400
  const messages: Record<ImageInspectionError['code'], string> = {
    image_too_large: '图片文件超过 4 MiB 上限',
    unsupported_image_type: '仅支持 JPEG、PNG 和非动画 WebP 图片',
    image_type_mismatch: '图片类型与文件内容不一致',
    invalid_image: '图片文件损坏或格式无效',
    animated_image_not_supported: '暂不支持动画图片',
    image_dimensions_exceeded: '图片尺寸不能超过 2048 x 2048',
  }
  return new ApiError(status, error.code, messages[error.code])
}

function normalizationError(error: ImageNormalizationError): ApiError {
  const status = error.code === 'image_output_too_large' ? 413 : 400
  const messages: Record<ImageNormalizationError['code'], string> = {
    image_decode_failed: '图片文件无法完整解码',
    image_dimensions_mismatch: '图片解码尺寸与文件声明不一致',
    image_encode_failed: '图片无法转换为安全格式',
    image_output_too_large: '转换后的图片超过 4 MiB 上限',
  }
  return new ApiError(status, error.code, messages[error.code])
}

async function reportSafely(
  dependencies: AttachmentHandlerDependencies,
  request: Request,
  error: unknown,
): Promise<void> {
  try {
    await dependencies.reportUnexpectedError(request, error)
  } catch {
    // Operational reporting must not replace the attachment response.
  }
}

export function createAttachmentHandler(
  dependencies: AttachmentHandlerDependencies,
): (request: Request) => Promise<Response> {
  if (!dependencies.allowedOrigins.trim() || dependencies.allowedOrigins.trim() === '*') {
    throw new Error('WebChat attachment service requires an explicit CORS origin allowlist')
  }
  const previewTtlSeconds = dependencies.previewTtlSeconds ?? 120
  if (
    !Number.isSafeInteger(previewTtlSeconds) ||
    previewTtlSeconds < 30 ||
    previewTtlSeconds > 120
  ) {
    throw new Error('Attachment preview TTL must be an integer between 30 and 120 seconds')
  }

  return async (request) => {
    const currentRequestId = requestId(request)
    const respond = (body: unknown, status = 200, additionalHeaders?: Record<string, string>) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          ...responseHeaders(request, dependencies.allowedOrigins, currentRequestId),
          ...additionalHeaders,
        },
      })

    if (!originAllowed(request, dependencies.allowedOrigins)) {
      return respond(
        { error: { code: 'origin_forbidden', message: '当前来源不允许访问此服务' } },
        403,
      )
    }
    if (request.method === 'OPTIONS')
      return new Response('ok', {
        headers: responseHeaders(request, dependencies.allowedOrigins, currentRequestId),
      })
    if (request.method !== 'POST') {
      return respond({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, 405)
    }
    if (!dependencies.enabled) {
      return respond(
        { error: { code: 'attachment_disabled', message: '图片输入功能尚未开放' } },
        503,
      )
    }

    try {
      const token = bearerToken(request)
      const services = dependencies.createServices()
      const user = await services.getUser(token)
      if (!user) throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')

      const access = await services.readMemberAccess(user.id)
      if (!access.accountEligible) {
        throw new ApiError(403, 'account_ineligible', '当前账号不能使用 AI 学习助手')
      }
      if (!access.enabled) {
        throw new ApiError(403, 'chat_access_denied', '当前账号尚未开通 AI 学习助手')
      }

      const action = await parseAttachmentRequest(request)
      if (action.action === 'preview') {
        const preview = await services.readPreview(user.id, action.attachmentId)
        const previewUrl = await services.signPreview(preview.objectKey, previewTtlSeconds)
        return respond({
          attachment: {
            id: preview.attachmentId,
            mediaType: preview.mediaType,
            width: preview.width,
            height: preview.height,
            byteSize: preview.byteSize,
            status: preview.status,
            previewUrl,
            expiresIn: previewTtlSeconds,
          },
          requestId: currentRequestId,
        })
      }

      if (action.action === 'remove') {
        const queued = await services.queueRemoval(user.id, action.attachmentId)
        if (!queued) {
          return respond({ removed: true, requestId: currentRequestId })
        }
        return respond({ removed: false, queued: true, requestId: currentRequestId }, 202)
      }

      const attachmentId = crypto.randomUUID()
      const ownerToken = crypto.randomUUID()
      const reservation = await services.reserveAttachment({
        userId: user.id,
        conversationId: action.conversationId,
        attachmentId,
        originalByteSize: action.image.bytes.byteLength,
        sourceMediaType: action.image.mediaType,
        sourceWidth: action.image.width,
        sourceHeight: action.image.height,
      })
      let objectMayExist = false
      try {
        if (!(await services.markValidating(user.id, reservation.attachmentId, ownerToken))) {
          throw new AttachmentServiceError('conflict')
        }
        const normalized = await dependencies.normalizeImage(action.image)
        if (!(await services.renewValidation(user.id, reservation.attachmentId, ownerToken))) {
          throw new AttachmentServiceError('conflict')
        }
        await services.uploadObject(reservation.objectKey, normalized.bytes)
        objectMayExist = true
        const previewUrl = await services.signPreview(reservation.objectKey, previewTtlSeconds)
        const preview = await services.completeAttachment({
          userId: user.id,
          attachmentId: reservation.attachmentId,
          ownerToken,
          objectKey: reservation.objectKey,
          byteSize: normalized.bytes.byteLength,
          width: normalized.width,
          height: normalized.height,
          sha256: normalized.sha256,
        })
        return respond(
          {
            attachment: {
              id: preview.attachmentId,
              mediaType: preview.mediaType,
              width: preview.width,
              height: preview.height,
              byteSize: preview.byteSize,
              status: preview.status,
              previewUrl,
              expiresIn: previewTtlSeconds,
            },
            requestId: currentRequestId,
          },
          201,
        )
      } catch (error) {
        if (objectMayExist) {
          try {
            await services.deleteObject(reservation.objectKey)
            objectMayExist = false
          } catch (deleteError) {
            await reportSafely(dependencies, request, deleteError)
          }
        }
        try {
          await services.failAttachment({
            userId: user.id,
            attachmentId: reservation.attachmentId,
            ownerToken,
            reason:
              error instanceof Error && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'upload_failed',
          })
        } catch (transitionError) {
          await reportSafely(dependencies, request, transitionError)
        }
        throw error
      }
    } catch (error) {
      const mapped =
        error instanceof AttachmentRequestError
          ? new ApiError(error.status, error.code, error.message)
          : error instanceof ImageInspectionError
            ? imageError(error)
            : error instanceof ImageNormalizationError
              ? normalizationError(error)
              : error instanceof AttachmentServiceError
                ? mapServiceError(error)
                : error instanceof ApiError
                  ? error
                  : null
      if (!mapped) await reportSafely(dependencies, request, error)
      const responseError =
        mapped ?? new ApiError(500, 'internal_error', '图片服务暂时不可用，请稍后重试')
      return respond(
        {
          error: { code: responseError.code, message: responseError.message },
          requestId: currentRequestId,
        },
        responseError.status,
        responseError.retryAfterSeconds === undefined
          ? undefined
          : { 'retry-after': String(responseError.retryAfterSeconds) },
      )
    }
  }
}
