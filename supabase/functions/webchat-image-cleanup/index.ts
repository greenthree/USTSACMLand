import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import {
  mapAttachmentDatabaseError,
  parseAttachmentBoolean,
} from '../webchat-attachment/database.ts'
import { createImageCleanupHandler, type ImageDeletionJob } from './handler.ts'

const BUCKET = 'webchat-images'
const OBJECT_KEY_PATTERN =
  /^user\/[0-9a-f-]{36}\/conversation\/[0-9a-f-]{36}\/attachment\/[0-9a-f-]{36}\.webp$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function parseJobs(value: unknown): ImageDeletionJob[] {
  if (!Array.isArray(value)) throw new Error('Image deletion queue RPC returned invalid data')
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Image deletion queue RPC returned an invalid row')
    }
    const row = candidate as Record<string, unknown>
    if (
      typeof row.attachment_id !== 'string' ||
      !UUID_PATTERN.test(row.attachment_id) ||
      typeof row.object_key !== 'string' ||
      !OBJECT_KEY_PATTERN.test(row.object_key) ||
      typeof row.attempt !== 'number' ||
      !Number.isSafeInteger(row.attempt) ||
      row.attempt < 1 ||
      row.attempt > 25
    ) {
      throw new Error('Image deletion queue RPC returned an invalid row')
    }
    return {
      attachmentId: row.attachment_id,
      objectKey: row.object_key,
      attempt: row.attempt,
    }
  })
}

function parseStorageAccounting(value: unknown): boolean {
  const row = Array.isArray(value) ? value[0] : null
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    typeof (row as Record<string, unknown>).accounting_consistent !== 'boolean'
  ) {
    throw new Error('Image Storage accounting RPC returned invalid data')
  }
  return (row as Record<string, unknown>).accounting_consistent as boolean
}

const handler = createImageCleanupHandler({
  isServiceRoleToken(token) {
    return gatewayVerifiedJwtRole(token) === 'service_role'
  },
  defaultLimit: 50,
  leaseSeconds: 600,
  createServices() {
    const serviceClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    return {
      async reconcileStorageAccounting() {
        const { data, error } = await serviceClient.rpc(
          'reconcile_webchat_image_storage_accounting',
        )
        if (error) mapAttachmentDatabaseError(error)
        return parseStorageAccounting(data)
      },
      async hasDeadLetters() {
        const { data, error } = await serviceClient.rpc(
          'list_webchat_image_deletion_dead_letters',
          { requested_limit: 1 },
        )
        if (error) mapAttachmentDatabaseError(error)
        if (!Array.isArray(data)) throw new Error('Dead-letter RPC returned invalid data')
        return data.length > 0
      },
      async claimJobs(ownerToken, limit, leaseSeconds) {
        const { data, error } = await serviceClient.rpc('claim_webchat_image_deletion_queue', {
          requested_owner_token: ownerToken,
          requested_limit: limit,
          requested_lease_seconds: leaseSeconds,
        })
        if (error) mapAttachmentDatabaseError(error)
        return parseJobs(data)
      },
      async deleteObject(objectKey) {
        const { error } = await serviceClient.storage.from(BUCKET).remove([objectKey])
        if (error) throw new Error('Could not remove queued WebChat image')
      },
      async completeJob(attachmentId, ownerToken) {
        const { data, error } = await serviceClient.rpc('complete_webchat_image_deletion', {
          requested_attachment_id: attachmentId,
          requested_owner_token: ownerToken,
        })
        if (error) mapAttachmentDatabaseError(error)
        return parseAttachmentBoolean(data, 'Image deletion completion')
      },
      async retryJob(attachmentId, ownerToken, errorCode, retryAfterSeconds) {
        const { data, error } = await serviceClient.rpc('retry_webchat_image_deletion', {
          requested_attachment_id: attachmentId,
          requested_owner_token: ownerToken,
          requested_error_code: errorCode,
          requested_retry_after_seconds: retryAfterSeconds,
        })
        if (error) mapAttachmentDatabaseError(error)
        return parseAttachmentBoolean(data, 'Image deletion retry')
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('webchat-image-cleanup', request, error))
  },
})

Deno.serve(handler)
