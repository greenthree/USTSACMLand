import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { resolveAuthenticatedUser } from '../webchat/authorization.ts'
import { parseWebChatMemberRuntimeAccess } from '../webchat/member-access.ts'
import {
  mapAttachmentDatabaseError,
  parseAttachmentBoolean,
  parseAttachmentPreview,
  parseAttachmentReservation,
  parseAttachmentValidationStart,
} from './database.ts'
import { createAttachmentHandler } from './handler.ts'
import { normalizeImage } from './image-normalizer.ts'

const BUCKET = 'webchat-images'
const DEFAULT_ALLOWED_ORIGINS = [
  'https://ustsacm.fun',
  'https://www.ustsacm.fun',
  'https://greenthree.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
].join(',')

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function databaseError(error: { code?: string; message?: string }): never {
  return mapAttachmentDatabaseError(error)
}

function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(120_000)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

const handler = createAttachmentHandler({
  enabled: Deno.env.get('CHAT_IMAGE_INPUT_ENABLED')?.trim().toLowerCase() === 'true',
  allowedOrigins: Deno.env.get('CHAT_ALLOWED_ORIGINS')?.trim() || DEFAULT_ALLOWED_ORIGINS,
  previewTtlSeconds: 120,
  normalizeImage(image) {
    return normalizeImage(image.bytes, image.mediaType)
  },
  createServices() {
    const serviceClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: boundedFetch },
      },
    )

    return {
      async getUser(token: string) {
        const { data, error } = await serviceClient.auth.getUser(token)
        return resolveAuthenticatedUser(data, error)
      },
      async readMemberAccess(userId: string) {
        const { data, error } = await serviceClient.rpc('read_webchat_member_runtime_access', {
          requested_user_id: userId,
        })
        if (error) throw new Error('Could not read WebChat member access')
        return parseWebChatMemberRuntimeAccess(data)
      },
      async reserveAttachment(input) {
        const { data, error } = await serviceClient.rpc('reserve_webchat_image_attachment', {
          requested_user_id: input.userId,
          requested_conversation_id: input.conversationId,
          requested_attachment_id: input.attachmentId,
          requested_original_mime: input.sourceMediaType,
          requested_original_bytes: input.originalByteSize,
        })
        if (error) databaseError(error)
        return parseAttachmentReservation(data)
      },
      async markValidating(userId, attachmentId, ownerToken) {
        const { data, error } = await serviceClient.rpc('start_webchat_image_validation', {
          requested_user_id: userId,
          requested_attachment_id: attachmentId,
          requested_owner_token: ownerToken,
          requested_lease_seconds: 600,
        })
        if (error) databaseError(error)
        return parseAttachmentValidationStart(data)
      },
      async renewValidation(userId, attachmentId, ownerToken) {
        const { data, error } = await serviceClient.rpc('renew_webchat_image_validation', {
          requested_user_id: userId,
          requested_attachment_id: attachmentId,
          requested_owner_token: ownerToken,
          requested_lease_seconds: 600,
        })
        if (error) databaseError(error)
        return parseAttachmentValidationStart(data)
      },
      async completeAttachment(input) {
        const { data, error } = await serviceClient.rpc('complete_webchat_image_validation', {
          requested_user_id: input.userId,
          requested_attachment_id: input.attachmentId,
          requested_owner_token: input.ownerToken,
          requested_object_bytes: input.byteSize,
          requested_width: input.width,
          requested_height: input.height,
          requested_sha256: input.sha256,
        })
        if (error) databaseError(error)
        return parseAttachmentPreview(data, input.objectKey)
      },
      async failAttachment(input) {
        const { data, error } = await serviceClient.rpc('fail_webchat_image_validation', {
          requested_user_id: input.userId,
          requested_attachment_id: input.attachmentId,
          requested_owner_token: input.ownerToken,
          requested_error_code: input.reason,
        })
        if (error) databaseError(error)
        parseAttachmentBoolean(data, 'Attachment failure transition')
      },
      async readPreview(userId, attachmentId) {
        const { data, error } = await serviceClient.rpc(
          'read_webchat_image_attachment_for_preview',
          {
            requested_user_id: userId,
            requested_attachment_id: attachmentId,
          },
        )
        if (error) databaseError(error)
        return parseAttachmentPreview(data)
      },
      async queueRemoval(userId, attachmentId) {
        const { data, error } = await serviceClient.rpc('queue_webchat_image_attachment_deletion', {
          requested_user_id: userId,
          requested_attachment_id: attachmentId,
          requested_reason: 'user_removed_pending_attachment',
        })
        if (error) databaseError(error)
        return parseAttachmentBoolean(data, 'Attachment deletion queue')
      },
      async uploadObject(objectKey, bytes) {
        const { error } = await serviceClient.storage.from(BUCKET).upload(objectKey, bytes, {
          cacheControl: '0',
          contentType: 'image/webp',
          upsert: false,
        })
        if (error) throw new Error('Could not store normalized WebChat image')
      },
      async deleteObject(objectKey) {
        const { error } = await serviceClient.storage.from(BUCKET).remove([objectKey])
        if (error) throw new Error('Could not remove normalized WebChat image')
      },
      async signPreview(objectKey, expiresInSeconds) {
        const { data, error } = await serviceClient.storage
          .from(BUCKET)
          .createSignedUrl(objectKey, expiresInSeconds)
        if (error || !data?.signedUrl) {
          throw new Error('Could not create WebChat image preview')
        }
        return data.signedUrl
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('webchat-attachment', request, error))
  },
})

Deno.serve(handler)
