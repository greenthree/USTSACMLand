// deno-lint-ignore-file require-await

import { strictEqual } from 'node:assert/strict'
import {
  AttachmentServiceError,
  createAttachmentHandler,
  type AttachmentHandlerDependencies,
  type AttachmentServices,
} from './handler.ts'

function png(): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const chunk = (type: string, data: Uint8Array) => {
    const result = new Uint8Array(12 + data.byteLength)
    new DataView(result.buffer).setUint32(0, data.byteLength, false)
    result.set(new TextEncoder().encode(type), 4)
    result.set(data, 8)
    return result
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, 2, false)
  view.setUint32(4, 3, false)
  header[8] = 8
  header[9] = 6
  const chunks = [
    chunk('IHDR', header),
    chunk('IDAT', Uint8Array.of(0)),
    chunk('IEND', new Uint8Array()),
  ]
  const result = new Uint8Array(
    signature.length + chunks.reduce((sum, value) => sum + value.length, 0),
  )
  result.set(signature)
  let offset = signature.length
  for (const value of chunks) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}

function uploadRequest(): Request {
  const form = new FormData()
  form.set('action', 'upload')
  form.set('conversationId', '11111111-1111-4111-8111-111111111111')
  const bytes = png()
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  form.set('file', new File([owned.buffer], 'private-name.png', { type: 'image/png' }))
  return new Request('https://example.test/webchat-attachment', {
    method: 'POST',
    headers: { authorization: 'Bearer valid', origin: 'https://ustsacm.fun' },
    body: form,
  })
}

function jsonRequest(action: 'preview' | 'remove'): Request {
  return new Request('https://example.test/webchat-attachment', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid',
      'content-type': 'application/json',
      origin: 'https://ustsacm.fun',
    },
    body: JSON.stringify({
      action,
      attachmentId: '22222222-2222-4222-8222-222222222222',
    }),
  })
}

function harness(overrides: Partial<AttachmentServices> = {}) {
  const calls: string[] = []
  const services: AttachmentServices = {
    getUser: async () => ({ id: 'user-1' }),
    readMemberAccess: async () => ({ accountEligible: true, enabled: true }),
    reserveAttachment: async () => ({
      attachmentId: '22222222-2222-4222-8222-222222222222',
      objectKey:
        'user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/conversation/11111111-1111-4111-8111-111111111111/attachment/22222222-2222-4222-8222-222222222222.webp',
      expiresAt: '2026-07-23T10:30:00.000Z',
    }),
    markValidating: async () => {
      calls.push('validating')
      return true
    },
    renewValidation: async () => {
      calls.push('renewed')
      return true
    },
    completeAttachment: async () => {
      calls.push('complete')
      return {
        attachmentId: '22222222-2222-4222-8222-222222222222',
        objectKey: 'private/object.webp',
        mediaType: 'image/webp',
        width: 2,
        height: 3,
        byteSize: 4,
        status: 'ready',
      }
    },
    failAttachment: async () => {
      calls.push('failed')
    },
    readPreview: async () => ({
      attachmentId: '22222222-2222-4222-8222-222222222222',
      objectKey: 'private/object.webp',
      mediaType: 'image/webp',
      width: 2,
      height: 3,
      byteSize: 4,
      status: 'ready',
    }),
    queueRemoval: async () => {
      calls.push('queued')
      return true
    },
    uploadObject: async () => {
      calls.push('uploaded')
    },
    deleteObject: async () => {
      calls.push('object-deleted')
    },
    signPreview: async () => {
      calls.push('signed')
      return 'https://signed.example.test/preview'
    },
    ...overrides,
  }
  const dependencies: AttachmentHandlerDependencies = {
    enabled: true,
    allowedOrigins: 'https://ustsacm.fun,http://localhost:5173',
    normalizeImage: async () => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
      width: 2,
      height: 3,
      mediaType: 'image/webp',
      sha256: 'a'.repeat(64),
    }),
    createServices: () => services,
    reportUnexpectedError: async () => {
      calls.push('reported')
    },
  }
  return { handler: createAttachmentHandler(dependencies), calls, dependencies }
}

Deno.test(
  'uploads only after authentication, reservation, normalization, and validation transition',
  async () => {
    const { handler, calls } = harness()
    const response = await handler(uploadRequest())
    strictEqual(response.status, 201)
    strictEqual(response.headers.get('cache-control'), 'private, no-store')
    const body = await response.json()
    strictEqual(body.attachment.mediaType, 'image/webp')
    strictEqual(body.attachment.previewUrl, 'https://signed.example.test/preview')
    strictEqual(JSON.stringify(body).includes('private-name.png'), false)
    strictEqual(calls.join(','), 'validating,renewed,uploaded,signed,complete')
  },
)

Deno.test('returns distinct safe HTTP contracts for global image guard failures', async () => {
  const cases = [
    ['global_upload_rate_limit', 429, 'attachment_global_rate_limited', null],
    ['global_upload_byte_budget', 429, 'attachment_global_byte_budget_reached', null],
    ['global_storage_capacity', 503, 'attachment_storage_capacity_reached', null],
    ['global_validation_concurrency', 503, 'attachment_processing_busy', '30'],
    ['global_uploads_paused', 503, 'attachment_uploads_paused', null],
  ] as const

  for (const [kind, status, code, retryAfter] of cases) {
    const { handler } = harness({
      reserveAttachment: async () => {
        throw new AttachmentServiceError(kind)
      },
    })
    const response = await handler(uploadRequest())
    const body = await response.json()
    strictEqual(response.status, status)
    strictEqual(body.error.code, code)
    strictEqual(response.headers.get('retry-after'), retryAfter)
    strictEqual(
      response.headers.get('access-control-expose-headers')?.includes('retry-after'),
      true,
    )
    strictEqual(/\d/.test(body.error.message), false)
    strictEqual(body.error.message.includes('WebChat'), false)
  }
})

Deno.test('keeps the existing session quota response contract', async () => {
  const { handler } = harness({
    reserveAttachment: async () => {
      throw new AttachmentServiceError('quota_exceeded')
    },
  })
  const response = await handler(uploadRequest())
  const body = await response.json()
  strictEqual(response.status, 409)
  strictEqual(body.error.code, 'attachment_limit_reached')
  strictEqual(response.headers.get('retry-after'), null)
})

Deno.test(
  'rolls back a stored object and marks a failed reservation when completion fails',
  async () => {
    const { handler, calls } = harness({
      completeAttachment: async () => {
        throw new AttachmentServiceError('conflict')
      },
    })
    const response = await handler(uploadRequest())
    strictEqual(response.status, 409)
    strictEqual(calls.join(','), 'validating,renewed,uploaded,signed,object-deleted,failed')
  },
)

Deno.test('rolls back before completion when the initial preview cannot be signed', async () => {
  let completed = false
  const { handler, calls } = harness({
    signPreview: async () => {
      calls.push('signed')
      throw new Error('signing unavailable')
    },
    completeAttachment: async () => {
      completed = true
      throw new Error('should not run')
    },
  })
  const response = await handler(uploadRequest())
  strictEqual(response.status, 500)
  strictEqual(completed, false)
  strictEqual(calls.join(','), 'validating,renewed,uploaded,signed,object-deleted,failed,reported')
})

Deno.test(
  'queues deletion instead of claiming Storage removal before worker confirmation',
  async () => {
    const { handler, calls } = harness()
    const response = await handler(jsonRequest('remove'))
    strictEqual(response.status, 202)
    const body = await response.json()
    strictEqual(body.queued, true)
    strictEqual(calls.join(','), 'queued')
  },
)

Deno.test('signs previews only after an owner-bound metadata lookup', async () => {
  const { handler } = harness()
  const response = await handler(jsonRequest('preview'))
  strictEqual(response.status, 200)
  const body = await response.json()
  strictEqual(body.attachment.previewUrl, 'https://signed.example.test/preview')
  strictEqual(body.attachment.expiresIn, 120)
})

Deno.test('rejects disabled access before parsing or touching attachment storage', async () => {
  let reserved = false
  const { dependencies } = harness({
    readMemberAccess: async () => ({ accountEligible: true, enabled: false }),
    reserveAttachment: async () => {
      reserved = true
      throw new Error('should not run')
    },
  })
  const response = await createAttachmentHandler(dependencies)(uploadRequest())
  strictEqual(response.status, 403)
  strictEqual(reserved, false)
})

Deno.test(
  'rejects disallowed origins and missing sessions with stable no-store responses',
  async () => {
    const { handler } = harness()
    const forbidden = uploadRequest()
    forbidden.headers.set('origin', 'https://attacker.example')
    strictEqual((await handler(forbidden)).status, 403)

    const missing = uploadRequest()
    missing.headers.delete('authorization')
    const response = await handler(missing)
    strictEqual(response.status, 401)
    strictEqual(response.headers.get('cache-control'), 'private, no-store')
  },
)
