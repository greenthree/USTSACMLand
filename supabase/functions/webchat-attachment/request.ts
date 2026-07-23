import { inspectImage, MAX_IMAGE_BYTES, type InspectedImage } from './image-format.ts'

export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024
export const MAX_ACTION_BODY_BYTES = 4 * 1024

export type AttachmentRequest =
  | {
      action: 'upload'
      conversationId: string
      image: InspectedImage & { bytes: Uint8Array }
    }
  | { action: 'preview'; attachmentId: string }
  | { action: 'remove'; attachmentId: string }

export type AttachmentRequestErrorCode =
  'unsupported_media_type' | 'request_body_too_large' | 'invalid_request'

export class AttachmentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: AttachmentRequestErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AttachmentRequestError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(message: string): never {
  throw new AttachmentRequestError(400, 'invalid_request', message)
}

function contentType(request: Request): string {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    invalid(`${field} must be a UUID`)
  }
  return value.toLowerCase()
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AttachmentRequestError(
      413,
      'request_body_too_large',
      `Request body exceeds ${maximumBytes} bytes`,
    )
  }
  if (!request.body) invalid('Request body is required')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maximumBytes) {
        try {
          await reader.cancel('request_body_too_large')
        } catch {
          // Cancellation is best-effort; the stable public response remains 413.
        }
        throw new AttachmentRequestError(
          413,
          'request_body_too_large',
          `Request body exceeds ${maximumBytes} bytes`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

async function parseJsonAction(request: Request): Promise<AttachmentRequest> {
  const bytes = await readBoundedBody(request, MAX_ACTION_BODY_BYTES)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    invalid('Request body must be valid UTF-8 JSON')
  }

  const body = asRecord(parsed)
  if (
    !body ||
    Object.keys(body).some((field) => !['action', 'attachmentId'].includes(field)) ||
    Object.keys(body).length !== 2
  ) {
    invalid('Attachment action fields are invalid')
  }
  if (body.action !== 'preview' && body.action !== 'remove') {
    invalid('Attachment action must be preview or remove')
  }
  return {
    action: body.action,
    attachmentId: assertUuid(body.attachmentId, 'attachmentId'),
  }
}

async function parseUpload(request: Request): Promise<AttachmentRequest> {
  const bytes = await readBoundedBody(request, MAX_UPLOAD_BODY_BYTES)
  let form: FormData
  try {
    const copy = new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      body: bytes.buffer,
    })
    form = await copy.formData()
  } catch {
    invalid('Multipart upload body is invalid')
  }

  const entries = Array.from(form.entries())
  const fields = entries.map(([name]) => name)
  if (
    entries.length !== 3 ||
    fields.filter((name) => name === 'action').length !== 1 ||
    fields.filter((name) => name === 'conversationId').length !== 1 ||
    fields.filter((name) => name === 'file').length !== 1 ||
    fields.some((name) => !['action', 'conversationId', 'file'].includes(name))
  ) {
    invalid('Upload must contain exactly action, conversationId, and file')
  }

  if (form.get('action') !== 'upload') invalid('Multipart action must be upload')
  const conversationId = assertUuid(form.get('conversationId'), 'conversationId')
  const file = form.get('file')
  if (!(file instanceof File)) invalid('file must be a single uploaded image')
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AttachmentRequestError(
      413,
      'request_body_too_large',
      `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
    )
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer())
  const inspected = inspectImage(imageBytes, file.type)
  return {
    action: 'upload',
    conversationId,
    image: { ...inspected, bytes: imageBytes },
  }
}

export async function parseAttachmentRequest(request: Request): Promise<AttachmentRequest> {
  const mediaType = contentType(request)
  if (mediaType === 'application/json') return await parseJsonAction(request)
  if (mediaType === 'multipart/form-data') return await parseUpload(request)
  throw new AttachmentRequestError(
    415,
    'unsupported_media_type',
    'Content-Type must be application/json or multipart/form-data',
  )
}
