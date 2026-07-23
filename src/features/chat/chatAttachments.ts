import type {
  AppendMessage,
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from '@assistant-ui/react'
import type { CreateUIMessage, FileUIPart, TextUIPart, UIMessage } from 'ai'
import { supabaseAnonKey, supabaseUrl } from '../../lib/supabase'
import { currentWebChatAccessToken, WebChatApiError } from './chatApi'

export const MAX_WEBCHAT_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_WEBCHAT_IMAGE_EDGE = 2_048
export const MAX_WEBCHAT_IMAGE_PIXELS = 4_194_304
export const MAX_WEBCHAT_IMAGES_PER_MESSAGE = 4

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ATTACHMENT_URN_PREFIX = 'urn:ustsacm:webchat-attachment:'

interface AttachmentPayload {
  attachment?: {
    id?: unknown
    mediaType?: unknown
    width?: unknown
    height?: unknown
    byteSize?: unknown
    status?: unknown
    previewUrl?: unknown
    expiresIn?: unknown
  }
  error?: {
    code?: unknown
    message?: unknown
  }
  requestId?: unknown
}

export interface WebChatAttachmentPreview {
  id: string
  mediaType: 'image/webp'
  width: number
  height: number
  byteSize: number
  status: 'ready' | 'attached'
  previewUrl: string
  expiresIn: number
}

export interface WebChatAttachmentClient {
  upload(
    file: File,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<WebChatAttachmentPreview>
  preview(
    attachmentId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<WebChatAttachmentPreview>
  remove(attachmentId: string): Promise<void>
}

export interface WebChatAttachmentClientOptions {
  apiUrl: string
  anonKey: string
  getAccessToken: () => Promise<string | null>
  createRequestId?: () => string
  fetch?: typeof globalThis.fetch
}

export interface WebChatAttachmentAdapterOptions {
  client: WebChatAttachmentClient
  getConversationId: () => Promise<string | null>
  /** Composer attachment count excluding items currently marked as uploading. */
  getAttachmentCount: () => number
  inspectImage?: (file: File) => Promise<void>
  onError?: (error: WebChatApiError) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function safePreviewUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    return (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' || (loopback && url.protocol === 'http:'))
    )
  } catch {
    return false
  }
}

function parseAttachmentPayload(payload: unknown): WebChatAttachmentPreview {
  if (!isRecord(payload)) throw new Error('图片服务返回了无效数据。')
  const attachment = isRecord(payload.attachment) ? payload.attachment : null
  if (
    !attachment ||
    typeof attachment.id !== 'string' ||
    !UUID_PATTERN.test(attachment.id) ||
    attachment.mediaType !== 'image/webp' ||
    !positiveInteger(attachment.width) ||
    !positiveInteger(attachment.height) ||
    !positiveInteger(attachment.byteSize) ||
    (attachment.status !== 'ready' && attachment.status !== 'attached') ||
    !safePreviewUrl(attachment.previewUrl) ||
    !positiveInteger(attachment.expiresIn) ||
    attachment.expiresIn > 120
  ) {
    throw new Error('图片服务返回了无效数据。')
  }
  return {
    id: attachment.id.toLowerCase(),
    mediaType: 'image/webp',
    width: attachment.width,
    height: attachment.height,
    byteSize: attachment.byteSize,
    status: attachment.status,
    previewUrl: attachment.previewUrl,
    expiresIn: attachment.expiresIn,
  }
}

async function attachmentError(response: Response): Promise<WebChatApiError> {
  let payload: AttachmentPayload | null = null
  try {
    const candidate: unknown = await response.clone().json()
    if (isRecord(candidate)) payload = candidate as AttachmentPayload
  } catch {
    // The service body is intentionally replaced with a bounded public message.
  }
  const code =
    typeof payload?.error?.code === 'string' && payload.error.code.trim()
      ? payload.error.code.trim()
      : `http_${response.status}`
  const message =
    typeof payload?.error?.message === 'string' && payload.error.message.trim()
      ? payload.error.message.trim()
      : response.status === 401
        ? '登录状态已失效，请重新登录。'
        : response.status === 413
          ? '图片超过上传限制。'
          : response.status === 503
            ? '图片输入功能尚未开放。'
            : '图片处理失败，请稍后重试。'
  const requestId =
    typeof payload?.requestId === 'string' && payload.requestId.trim()
      ? payload.requestId.trim()
      : response.headers.get('x-request-id')?.trim() || null
  return new WebChatApiError(message, response.status, code, requestId)
}

export function webChatAttachmentUrn(attachmentId: string): string {
  if (!UUID_PATTERN.test(attachmentId)) throw new Error('图片附件 ID 无效。')
  return `${ATTACHMENT_URN_PREFIX}${attachmentId.toLowerCase()}`
}

export function parseWebChatAttachmentUrn(value: string): string | null {
  if (!value.startsWith(ATTACHMENT_URN_PREFIX)) return null
  const attachmentId = value.slice(ATTACHMENT_URN_PREFIX.length)
  return UUID_PATTERN.test(attachmentId) ? attachmentId.toLowerCase() : null
}

export function resolveWebChatAttachmentApiUrl(configuredSupabaseUrl?: string | null): string {
  return configuredSupabaseUrl
    ? `${configuredSupabaseUrl.replace(/\/+$/, '')}/functions/v1/webchat-attachment`
    : '/functions/v1/webchat-attachment'
}

export function createWebChatAttachmentClient({
  apiUrl,
  anonKey,
  getAccessToken,
  createRequestId = () => crypto.randomUUID(),
  fetch: fetchImplementation = globalThis.fetch.bind(globalThis),
}: WebChatAttachmentClientOptions): WebChatAttachmentClient {
  const previewCache = new Map<string, { preview: WebChatAttachmentPreview; expiresAt: number }>()

  const authorizedFetch = async (
    body: BodyInit,
    contentType?: string,
    externalSignal?: AbortSignal,
  ): Promise<Response> => {
    const accessToken = await getAccessToken()
    if (!accessToken) {
      throw new WebChatApiError('登录状态已失效，请重新登录。', 401, 'unauthorized')
    }
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    if (externalSignal?.aborted) controller.abort()
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = globalThis.setTimeout(() => controller.abort(), 30_000)
    let response: Response
    try {
      response = await fetchImplementation(apiUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          'x-request-id': createRequestId(),
          ...(contentType ? { 'content-type': contentType } : {}),
        },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      if (externalSignal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
      if (controller.signal.aborted) {
        throw new WebChatApiError('图片服务请求超时，请检查连接后重试。', null, 'request_timeout')
      }
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new WebChatApiError('图片上传网络连接失败，请检查连接后重试。', null, 'network_error')
    } finally {
      globalThis.clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abortFromCaller)
    }
    if (!response.ok) throw await attachmentError(response)
    return response
  }

  const readPreview = async (response: Response) => {
    const preview = parseAttachmentPayload(await response.json())
    previewCache.set(preview.id, {
      preview,
      expiresAt: Date.now() + Math.max(1, preview.expiresIn - 5) * 1_000,
    })
    return preview
  }

  return {
    async upload(file, conversationId, signal) {
      if (!UUID_PATTERN.test(conversationId)) throw new Error('当前历史会话尚未准备完成。')
      const form = new FormData()
      form.set('action', 'upload')
      form.set('conversationId', conversationId.toLowerCase())
      form.set('file', file)
      return readPreview(await authorizedFetch(form, undefined, signal))
    },
    async preview(attachmentId, options) {
      if (!UUID_PATTERN.test(attachmentId)) throw new Error('图片附件 ID 无效。')
      const normalizedId = attachmentId.toLowerCase()
      const cached = previewCache.get(normalizedId)
      if (!options?.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.preview
      const body = JSON.stringify({ action: 'preview', attachmentId: normalizedId })
      return readPreview(await authorizedFetch(body, 'application/json'))
    },
    async remove(attachmentId) {
      if (!UUID_PATTERN.test(attachmentId)) throw new Error('图片附件 ID 无效。')
      const normalizedId = attachmentId.toLowerCase()
      const body = JSON.stringify({ action: 'remove', attachmentId: normalizedId })
      await authorizedFetch(body, 'application/json')
      previewCache.delete(normalizedId)
    },
  }
}

async function browserImageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('图片文件无法读取。'))
      image.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function inspectWebChatImage(file: File): Promise<void> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('仅支持 JPEG、PNG 和非动画 WebP 图片。')
  }
  if (file.size < 1) throw new Error('图片文件为空。')
  if (file.size > MAX_WEBCHAT_IMAGE_BYTES) throw new Error('单张图片不能超过 4 MiB。')

  let dimensions: { width: number; height: number }
  try {
    dimensions = await browserImageDimensions(file)
  } catch {
    throw new Error('图片文件损坏或无法读取。')
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_WEBCHAT_IMAGE_EDGE ||
    dimensions.height > MAX_WEBCHAT_IMAGE_EDGE ||
    dimensions.width * dimensions.height > MAX_WEBCHAT_IMAGE_PIXELS
  ) {
    throw new Error('图片尺寸不能超过 2048 x 2048。')
  }
}

function createLocalAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `webchat-attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function completeAttachment(
  attachment: PendingAttachment,
  attachmentId?: string,
): CompleteAttachment {
  const imagePart = attachment.content?.find((part) => part.type === 'image')
  const parsedId = imagePart ? parseWebChatAttachmentUrn(imagePart.image) : null
  const resolvedId = attachmentId ?? parsedId
  if (!resolvedId) {
    throw new Error('图片附件引用无效，请重新上传。')
  }
  return {
    ...attachment,
    status: { type: 'complete' },
    content: [{ type: 'image', image: webChatAttachmentUrn(resolvedId) }],
  }
}

export function createWebChatAttachmentAdapter({
  client,
  getConversationId,
  getAttachmentCount,
  inspectImage = inspectWebChatImage,
  onError,
}: WebChatAttachmentAdapterOptions): AttachmentAdapter {
  let uploadsInFlight = 0
  type UploadRecord = {
    cancelled: boolean
    consumed: boolean
    controller: AbortController
    promise: Promise<WebChatAttachmentPreview>
  }
  const uploads = new Map<string, UploadRecord>()
  const completedUploadIds = new Map<string, string>()
  const report = (error: unknown) => {
    const normalized =
      error instanceof WebChatApiError
        ? error
        : new WebChatApiError(
            error instanceof Error && error.message.trim()
              ? error.message
              : '图片处理失败，请稍后重试。',
            null,
            'attachment_client_error',
          )
    onError?.(normalized)
    return normalized
  }

  return {
    accept: 'image/jpeg,image/png,image/webp',
    async *add({ file }): AsyncGenerator<PendingAttachment, void> {
      const localId = createLocalAttachmentId()
      const runningAttachment: PendingAttachment = {
        id: localId,
        type: 'image',
        name: file.name || '图片',
        contentType: file.type,
        file,
        status: { type: 'running', reason: 'uploading', progress: 0 },
      }

      if (getAttachmentCount() + uploadsInFlight >= MAX_WEBCHAT_IMAGES_PER_MESSAGE) {
        const error = report(new Error('每条消息最多添加 4 张图片。'))
        yield {
          ...runningAttachment,
          status: { type: 'incomplete', reason: 'error', message: error.message },
        }
        return
      }

      uploadsInFlight += 1
      const controller = new AbortController()
      const uploadPromise = (async () => {
        await inspectImage(file)
        const conversationId = await getConversationId()
        if (!conversationId) throw new Error('当前历史会话尚未准备完成。')
        return client.upload(file, conversationId, controller.signal)
      })()
      // The generator is suspended at the first yield; attach a sink now so a
      // synchronous validation failure cannot become an unhandled rejection.
      void uploadPromise.catch(() => undefined)
      const record: UploadRecord = {
        cancelled: false,
        consumed: false,
        controller,
        promise: uploadPromise,
      }
      uploads.set(localId, record)

      // Make the item visible before validation or network I/O completes.
      yield runningAttachment

      try {
        const uploaded = await uploadPromise
        completedUploadIds.set(localId, uploaded.id)
        if (record.cancelled || record.consumed) {
          completedUploadIds.delete(localId)
          return
        }
        yield {
          ...runningAttachment,
          contentType: uploaded.mediaType,
          content: [{ type: 'image', image: webChatAttachmentUrn(uploaded.id) }],
          status: { type: 'requires-action', reason: 'composer-send' },
        }
      } catch (error) {
        if (record.cancelled) return
        const normalized = report(error)
        yield {
          ...runningAttachment,
          status: { type: 'incomplete', reason: 'error', message: normalized.message },
        }
      } finally {
        uploadsInFlight -= 1
        uploads.delete(localId)
      }
    },
    async send(attachment) {
      try {
        let attachmentId: string | undefined
        const imagePart = attachment.content?.find((part) => part.type === 'image')
        if (imagePart) attachmentId = parseWebChatAttachmentUrn(imagePart.image) ?? undefined

        if (!attachmentId) {
          const record = uploads.get(attachment.id)
          if (record) {
            record.consumed = true
            const uploaded = await record.promise
            attachmentId = uploaded.id
          } else {
            attachmentId = completedUploadIds.get(attachment.id)
          }
        }

        const complete = completeAttachment(attachment, attachmentId)
        uploads.delete(attachment.id)
        completedUploadIds.delete(attachment.id)
        return complete
      } catch (error) {
        throw report(error)
      }
    },
    async remove(attachment: Attachment) {
      try {
        const record = uploads.get(attachment.id)
        if (record) {
          record.cancelled = true
          record.controller.abort()
          uploads.delete(attachment.id)
          completedUploadIds.delete(attachment.id)
          void record.promise.then((uploaded) => client.remove(uploaded.id)).catch(() => undefined)
          return
        }

        const imagePart = attachment.content?.find((part) => part.type === 'image')
        const attachmentId = imagePart
          ? parseWebChatAttachmentUrn(imagePart.image)
          : (completedUploadIds.get(attachment.id) ?? null)
        if (!attachmentId) return
        await client.remove(attachmentId)
        completedUploadIds.delete(attachment.id)
      } catch (error) {
        throw report(error)
      }
    },
  }
}

export function toWebChatCreateMessage<UI_MESSAGE extends UIMessage = UIMessage>(
  message: AppendMessage,
): CreateUIMessage<UI_MESSAGE> {
  const parts: Array<TextUIPart | FileUIPart> = []
  for (const part of message.content) {
    if (part.type === 'text' && part.text.trim()) {
      parts.push({ type: 'text', text: part.text })
    }
  }

  for (const attachment of message.attachments ?? []) {
    const imagePart = attachment.content.find((part) => part.type === 'image')
    const attachmentId = imagePart ? parseWebChatAttachmentUrn(imagePart.image) : null
    if (!attachmentId) throw new Error('图片附件引用无效，请重新上传。')
    parts.push({
      type: 'file',
      mediaType: 'image/webp',
      url: webChatAttachmentUrn(attachmentId),
    })
  }

  return {
    role: message.role,
    parts,
    metadata: message.metadata,
  } as CreateUIMessage<UI_MESSAGE>
}

export const browserWebChatAttachmentClient = createWebChatAttachmentClient({
  apiUrl: resolveWebChatAttachmentApiUrl(supabaseUrl),
  anonKey: supabaseAnonKey ?? '',
  getAccessToken: currentWebChatAccessToken,
})

export const webChatImageInputEnabled =
  import.meta.env.VITE_WEBCHAT_IMAGE_INPUT_ENABLED?.trim().toLowerCase() === 'true'
