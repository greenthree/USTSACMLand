import { strictEqual, rejects } from 'node:assert/strict'
import { AttachmentRequestError, MAX_ACTION_BODY_BYTES, parseAttachmentRequest } from './request.ts'

function png(width = 2, height = 3): Uint8Array {
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
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  header[8] = 8
  header[9] = 6
  const chunks = [
    chunk('IHDR', header),
    chunk('IDAT', Uint8Array.of(0)),
    chunk('IEND', new Uint8Array()),
  ]
  const result = new Uint8Array(
    signature.byteLength + chunks.reduce((total, current) => total + current.byteLength, 0),
  )
  result.set(signature)
  let offset = signature.byteLength
  for (const current of chunks) {
    result.set(current, offset)
    offset += current.byteLength
  }
  return result
}

function uploadRequest(
  options: {
    conversationId?: string
    fileType?: string
    fileBytes?: Uint8Array
    extraField?: boolean
  } = {},
): Request {
  const sourceBytes = options.fileBytes ?? png()
  const ownedBytes = new Uint8Array(sourceBytes.byteLength)
  ownedBytes.set(sourceBytes)
  const form = new FormData()
  form.set('action', 'upload')
  form.set('conversationId', options.conversationId ?? '11111111-1111-4111-8111-111111111111')
  form.set(
    'file',
    new File([ownedBytes.buffer], 'ignored-original-name.png', {
      type: options.fileType ?? 'image/png',
    }),
  )
  if (options.extraField) form.set('userId', 'forbidden')
  return new Request('https://example.test/webchat-attachment', { method: 'POST', body: form })
}

function jsonRequest(value: unknown): Request {
  return new Request('https://example.test/webchat-attachment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
}

async function expectRequestError(
  request: Request,
  status: number,
  code: AttachmentRequestError['code'],
): Promise<void> {
  await rejects(parseAttachmentRequest(request), (error: unknown) => {
    strictEqual(error instanceof AttachmentRequestError, true)
    strictEqual((error as AttachmentRequestError).status, status)
    strictEqual((error as AttachmentRequestError).code, code)
    return true
  })
}

Deno.test('parses a strict multipart upload without exposing the original filename', async () => {
  const result = await parseAttachmentRequest(uploadRequest())
  strictEqual(result.action, 'upload')
  if (result.action !== 'upload') throw new Error('Expected upload')
  strictEqual(result.conversationId, '11111111-1111-4111-8111-111111111111')
  strictEqual(result.image.format, 'png')
  strictEqual(result.image.width, 2)
  strictEqual('name' in result.image, false)
})

Deno.test('parses preview and remove JSON actions with exact fields', async () => {
  const preview = await parseAttachmentRequest(
    jsonRequest({ action: 'preview', attachmentId: '22222222-2222-4222-8222-222222222222' }),
  )
  strictEqual(preview.action, 'preview')

  const remove = await parseAttachmentRequest(
    jsonRequest({ action: 'remove', attachmentId: '33333333-3333-4333-8333-333333333333' }),
  )
  strictEqual(remove.action, 'remove')
})

Deno.test('rejects authority fields, duplicate upload fields, and invalid UUIDs', async () => {
  await expectRequestError(uploadRequest({ extraField: true }), 400, 'invalid_request')
  await expectRequestError(
    jsonRequest({
      action: 'preview',
      attachmentId: 'not-a-uuid',
      userId: '11111111-1111-4111-8111-111111111111',
    }),
    400,
    'invalid_request',
  )
})

Deno.test('rejects forged image MIME and unsupported request media types', async () => {
  await rejects(
    parseAttachmentRequest(uploadRequest({ fileType: 'image/jpeg' })),
    (error: unknown) => {
      strictEqual(error instanceof Error, true)
      strictEqual((error as { code?: string }).code, 'image_type_mismatch')
      return true
    },
  )
  await expectRequestError(
    new Request('https://example.test/webchat-attachment', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'upload',
    }),
    415,
    'unsupported_media_type',
  )
})

Deno.test('cancels action bodies that exceed the byte limit', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_ACTION_BODY_BYTES + 1))
    },
    cancel() {
      cancelled = true
    },
  })
  await expectRequestError(
    new Request('https://example.test/webchat-attachment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
    }),
    413,
    'request_body_too_large',
  )
  strictEqual(cancelled, true)
})
