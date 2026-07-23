import {
  AttachmentServiceError,
  type AttachmentPreview,
  type AttachmentReservation,
} from './handler.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OBJECT_KEY_PATTERN =
  /^user\/[0-9a-f-]{36}\/conversation\/[0-9a-f-]{36}\/attachment\/[0-9a-f-]{36}\.webp$/

interface DatabaseError {
  code?: string
  message?: string
}

const GLOBAL_IMAGE_ERROR_KINDS = new Map<
  string,
  { code: string; kind: AttachmentServiceError['kind'] }
>([
  [
    'WebChat global image upload rate limit reached.',
    { code: '54000', kind: 'global_upload_rate_limit' },
  ],
  [
    'WebChat global image upload byte budget reached.',
    { code: '54000', kind: 'global_upload_byte_budget' },
  ],
  [
    'WebChat global image Storage capacity reached.',
    { code: '54000', kind: 'global_storage_capacity' },
  ],
  [
    'WebChat global image validation concurrency limit reached.',
    { code: '54000', kind: 'global_validation_concurrency' },
  ],
  ['WebChat image uploads are globally paused.', { code: '55000', kind: 'global_uploads_paused' }],
])

function firstRow(value: unknown, name: string): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${name} RPC returned invalid data`)
  }
  return row as Record<string, unknown>
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Attachment RPC returned an invalid ${field}`)
  }
  return value.toLowerCase()
}

function objectKey(value: unknown): string {
  if (typeof value !== 'string' || !OBJECT_KEY_PATTERN.test(value)) {
    throw new Error('Attachment RPC returned an invalid object key')
  }
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Attachment RPC returned an invalid ${field}`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Attachment RPC returned an invalid ${field}`)
  }
  return value
}

export function parseAttachmentReservation(value: unknown): AttachmentReservation {
  const row = firstRow(value, 'Attachment reservation')
  if (row.status !== 'reserved' || row.bucket_id !== 'webchat-images') {
    throw new Error('Attachment reservation RPC returned an invalid state')
  }
  return {
    attachmentId: uuid(row.id, 'attachment ID'),
    objectKey: objectKey(row.object_key),
    expiresAt: timestamp(row.expires_at, 'expiration time'),
  }
}

export function parseAttachmentValidationStart(value: unknown): boolean {
  const row = firstRow(value, 'Attachment validation start')
  if (
    !['validating', 'ready', 'attached'].includes(String(row.status)) ||
    row.bucket_id !== 'webchat-images'
  ) {
    throw new Error('Attachment validation start RPC returned an invalid state')
  }
  objectKey(row.object_key)
  timestamp(row.expires_at, 'expiration time')
  return true
}

export function parseAttachmentPreview(
  value: unknown,
  fallbackObjectKey?: string,
): AttachmentPreview {
  const row = firstRow(value, 'Attachment preview')
  if (row.status !== 'ready' && row.status !== 'attached') {
    throw new Error('Attachment preview RPC returned an invalid state')
  }
  if (row.media_type !== 'image/webp') {
    throw new Error('Attachment preview RPC returned an invalid media type')
  }
  const preview: AttachmentPreview = {
    attachmentId: uuid(row.id, 'attachment ID'),
    objectKey: objectKey(row.object_key ?? fallbackObjectKey),
    mediaType: 'image/webp',
    width: positiveInteger(row.width, 'width'),
    height: positiveInteger(row.height, 'height'),
    byteSize: positiveInteger(row.object_bytes, 'byte size'),
    status: row.status,
  }
  if (
    preview.width > 2_048 ||
    preview.height > 2_048 ||
    preview.width * preview.height > 4_194_304 ||
    preview.byteSize > 4_194_304
  ) {
    throw new Error('Attachment preview RPC returned out-of-range metadata')
  }
  return preview
}

export function parseAttachmentBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} RPC returned invalid data`)
  return value
}

export function mapAttachmentDatabaseError(error: DatabaseError): never {
  const message = error.message ?? ''
  const globalImageError = GLOBAL_IMAGE_ERROR_KINDS.get(message)
  if (globalImageError && globalImageError.code === error.code) {
    throw new AttachmentServiceError(globalImageError.kind)
  }
  if (error.code === '42501') throw new AttachmentServiceError('forbidden')
  if (error.code === 'P0002') throw new AttachmentServiceError('not_found')
  if (error.code === '23505' || error.code === '40001') {
    throw new AttachmentServiceError('conflict')
  }
  if (error.code === '54000') throw new AttachmentServiceError('quota_exceeded')
  if (error.code === '55000') {
    throw new AttachmentServiceError(
      message.toLowerCase().includes('frozen') ? 'account_frozen' : 'conflict',
    )
  }
  if (['22001', '22004', '22023', '23514'].includes(error.code ?? '')) {
    throw new AttachmentServiceError('invalid_request')
  }
  throw new Error('WebChat attachment database operation failed')
}
