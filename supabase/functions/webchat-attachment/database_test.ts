import { strictEqual, throws } from 'node:assert/strict'
import {
  mapAttachmentDatabaseError,
  parseAttachmentBoolean,
  parseAttachmentPreview,
  parseAttachmentReservation,
  parseAttachmentValidationStart,
} from './database.ts'
import { AttachmentServiceError } from './handler.ts'

const id = '22222222-2222-4222-8222-222222222222'
const key =
  'user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/conversation/11111111-1111-4111-8111-111111111111/attachment/22222222-2222-4222-8222-222222222222.webp'

Deno.test('parses reservation, validation, and preview rows without exposing extra fields', () => {
  strictEqual(
    parseAttachmentReservation([
      {
        id,
        status: 'reserved',
        bucket_id: 'webchat-images',
        object_key: key,
        expires_at: '2026-07-23T10:30:00.000Z',
      },
    ]).objectKey,
    key,
  )
  strictEqual(
    parseAttachmentValidationStart({
      status: 'validating',
      bucket_id: 'webchat-images',
      object_key: key,
      expires_at: '2026-07-23T10:30:00.000Z',
    }),
    true,
  )
  const preview = parseAttachmentPreview(
    {
      id,
      status: 'ready',
      media_type: 'image/webp',
      object_bytes: 123,
      width: 20,
      height: 30,
      sha256: 'a'.repeat(64),
    },
    key,
  )
  strictEqual(preview.objectKey, key)
  strictEqual('sha256' in preview, false)
})

Deno.test('rejects unsafe object keys and out-of-range metadata', () => {
  throws(() =>
    parseAttachmentReservation({
      id,
      status: 'reserved',
      bucket_id: 'webchat-images',
      object_key: '../private.webp',
      expires_at: '2026-07-23T10:30:00.000Z',
    }),
  )
  throws(() =>
    parseAttachmentPreview({
      id,
      status: 'ready',
      media_type: 'image/webp',
      object_bytes: 123,
      width: 2_049,
      height: 1,
      object_key: key,
    }),
  )
})

Deno.test('maps bounded database failures and hides unknown messages', () => {
  const cases = [
    ['42501', 'forbidden'],
    ['P0002', 'not_found'],
    ['23505', 'conflict'],
    ['54000', 'quota_exceeded'],
    ['22023', 'invalid_request'],
  ] as const
  for (const [code, kind] of cases) {
    throws(
      () => mapAttachmentDatabaseError({ code, message: 'private database details' }),
      (error: unknown) =>
        error instanceof AttachmentServiceError &&
        error.kind === kind &&
        !error.message.includes('private'),
    )
  }
  throws(
    () => mapAttachmentDatabaseError({ code: '55000', message: 'uploads are frozen' }),
    (error: unknown) => error instanceof AttachmentServiceError && error.kind === 'account_frozen',
  )
  throws(
    () => mapAttachmentDatabaseError({ code: 'XX000', message: 'secret row data' }),
    /database operation failed/,
  )
})

Deno.test('maps exact global image guard messages to distinct safe failures', () => {
  const cases = [
    ['54000', 'WebChat global image upload rate limit reached.', 'global_upload_rate_limit'],
    ['54000', 'WebChat global image upload byte budget reached.', 'global_upload_byte_budget'],
    ['54000', 'WebChat global image Storage capacity reached.', 'global_storage_capacity'],
    [
      '54000',
      'WebChat global image validation concurrency limit reached.',
      'global_validation_concurrency',
    ],
    ['55000', 'WebChat image uploads are globally paused.', 'global_uploads_paused'],
  ] as const

  for (const [code, message, kind] of cases) {
    throws(
      () => mapAttachmentDatabaseError({ code, message }),
      (error: unknown) =>
        error instanceof AttachmentServiceError &&
        error.kind === kind &&
        !error.message.includes(message),
    )
  }
})

Deno.test(
  'falls back safely when global guard messages are unknown or do not exactly match',
  () => {
    throws(
      () =>
        mapAttachmentDatabaseError({
          code: '54000',
          message: 'WebChat global image upload rate limit reached. private threshold=123',
        }),
      (error: unknown) =>
        error instanceof AttachmentServiceError && error.kind === 'quota_exceeded',
    )
    throws(
      () =>
        mapAttachmentDatabaseError({
          code: '55000',
          message: 'WebChat image uploads are globally paused. private operator detail',
        }),
      (error: unknown) => error instanceof AttachmentServiceError && error.kind === 'conflict',
    )
    throws(
      () =>
        mapAttachmentDatabaseError({
          code: '55000',
          message: 'WebChat global image upload rate limit reached.',
        }),
      (error: unknown) => error instanceof AttachmentServiceError && error.kind === 'conflict',
    )
  },
)

Deno.test('requires exact boolean transition results', () => {
  strictEqual(parseAttachmentBoolean(true, 'Deletion queue'), true)
  throws(() => parseAttachmentBoolean('true', 'Deletion queue'), /invalid data/)
})
