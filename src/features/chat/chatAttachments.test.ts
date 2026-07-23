import type { AppendMessage, PendingAttachment } from '@assistant-ui/react'
import {
  createWebChatAttachmentAdapter,
  createWebChatAttachmentClient,
  parseWebChatAttachmentUrn,
  toWebChatCreateMessage,
  webChatAttachmentUrn,
  type WebChatAttachmentPreview,
} from './chatAttachments'

const attachmentId = '22222222-2222-4222-8222-222222222222'
const conversationId = '11111111-1111-4111-8111-111111111111'
const preview: WebChatAttachmentPreview = {
  id: attachmentId,
  mediaType: 'image/webp',
  width: 640,
  height: 480,
  byteSize: 12_345,
  status: 'ready',
  previewUrl: 'https://storage.example.test/signed-preview',
  expiresIn: 120,
}

function previewResponse(status: 'ready' | 'attached' = 'ready') {
  return new Response(JSON.stringify({ attachment: { ...preview, status } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function drain<T>(generator: AsyncGenerator<T, void>): Promise<T[]> {
  const values: T[] = []
  for await (const value of generator) values.push(value)
  return values
}

function addAttachment(
  adapter: ReturnType<typeof createWebChatAttachmentAdapter>,
  file: File,
): AsyncGenerator<PendingAttachment, void> {
  return adapter.add({ file }) as AsyncGenerator<PendingAttachment, void>
}

describe('WebChat image attachment client', () => {
  it('round-trips only canonical attachment URNs', () => {
    const urn = webChatAttachmentUrn(attachmentId.toUpperCase())
    expect(urn).toBe(`urn:ustsacm:webchat-attachment:${attachmentId}`)
    expect(parseWebChatAttachmentUrn(urn)).toBe(attachmentId)
    expect(parseWebChatAttachmentUrn('data:image/png;base64,secret')).toBeNull()
    expect(() => webChatAttachmentUrn('not-a-uuid')).toThrow(/ID 无效/)
  })

  it('uploads with a fresh session, keeps signed previews in memory, and removes by UUID', async () => {
    const requests: Array<{ headers: Headers; body: BodyInit | null | undefined }> = []
    const fetchMock: typeof fetch = vi.fn(async (_input, init) => {
      requests.push({ headers: new Headers(init?.headers), body: init?.body })
      if (requests.length === 2) return new Response(JSON.stringify({ removed: true }))
      return previewResponse()
    })
    const client = createWebChatAttachmentClient({
      apiUrl: 'https://project.supabase.co/functions/v1/webchat-attachment',
      anonKey: 'anon-key',
      getAccessToken: async () => 'access-token',
      createRequestId: () => 'request-id',
      fetch: fetchMock,
    })
    const file = new File(['image-bytes'], 'original-name.png', { type: 'image/png' })

    expect(await client.upload(file, conversationId)).toEqual(preview)
    expect(await client.preview(attachmentId)).toEqual(preview)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer access-token')
    expect(requests[0]?.headers.get('apikey')).toBe('anon-key')
    expect(requests[0]?.headers.get('content-type')).toBeNull()
    expect(requests[0]?.body).toBeInstanceOf(FormData)
    expect((requests[0]?.body as FormData).get('conversationId')).toBe(conversationId)

    await client.remove(attachmentId)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests[1]?.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(requests[1]?.body))).toEqual({ action: 'remove', attachmentId })
  })

  it('bypasses the in-memory preview cache when a rendered image needs a new signature', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => previewResponse('attached'))
    const client = createWebChatAttachmentClient({
      apiUrl: 'https://project.supabase.co/functions/v1/webchat-attachment',
      anonKey: 'anon-key',
      getAccessToken: async () => 'access-token',
      fetch: fetchMock,
    })

    expect(await client.preview(attachmentId)).toEqual({ ...preview, status: 'attached' })
    expect(await client.preview(attachmentId)).toEqual({ ...preview, status: 'attached' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(await client.preview(attachmentId, { forceRefresh: true })).toEqual({
      ...preview,
      status: 'attached',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows an uploading item immediately and limits concurrent additions to four images', async () => {
    const inspectionResolvers: Array<() => void> = []
    const errors: string[] = []
    const adapter = createWebChatAttachmentAdapter({
      client: {
        upload: async () => preview,
        preview: async () => preview,
        remove: async () => undefined,
      },
      getConversationId: async () => conversationId,
      getAttachmentCount: () => 0,
      inspectImage: () =>
        new Promise<void>((resolve) => {
          inspectionResolvers.push(resolve)
        }),
      onError: (error) => errors.push(error.message),
    })
    const file = new File(['image'], 'problem.png', { type: 'image/png' })
    const firstFour = Array.from({ length: 4 }, () => drain(addAttachment(adapter, file)))

    const fifth = await drain(addAttachment(adapter, file))
    expect(fifth[0]).toMatchObject({
      status: { type: 'incomplete', reason: 'error', message: '每条消息最多添加 4 张图片。' },
    })
    inspectionResolvers.forEach((resolve) => resolve())
    const uploaded = await Promise.all(firstFour)

    expect(uploaded).toHaveLength(4)
    expect(uploaded[0]?.[0]).toMatchObject({
      id: expect.any(String),
      status: { type: 'running', reason: 'uploading', progress: 0 },
    })
    expect(uploaded[0]?.at(-1)).toMatchObject({
      id: expect.any(String),
      status: { type: 'requires-action', reason: 'composer-send' },
      content: [{ type: 'image', image: webChatAttachmentUrn(attachmentId) }],
    })
    expect(uploaded[0]?.[0]?.id).toBe(uploaded[0]?.at(-1)?.id)
    expect(errors).toEqual(['每条消息最多添加 4 张图片。'])
  })

  it('keeps the same attachment id while send waits for a slow upload', async () => {
    let resolveUpload!: (value: WebChatAttachmentPreview) => void
    const upload = vi.fn(
      () => new Promise<WebChatAttachmentPreview>((resolve) => (resolveUpload = resolve)),
    )
    const adapter = createWebChatAttachmentAdapter({
      client: {
        upload,
        preview: async () => preview,
        remove: async () => undefined,
      },
      getConversationId: async () => conversationId,
      getAttachmentCount: () => 0,
      inspectImage: async () => undefined,
    })
    const iterator = addAttachment(adapter, new File(['image'], 'slow.png', { type: 'image/png' }))
    const first = await iterator.next()
    expect(first.value).toMatchObject({
      id: expect.any(String),
      status: { type: 'running', reason: 'uploading', progress: 0 },
    })

    const sendPromise = adapter.send(first.value!)
    expect(upload).toHaveBeenCalledTimes(1)
    resolveUpload(preview)
    await expect(sendPromise).resolves.toMatchObject({
      id: first.value?.id,
      status: { type: 'complete' },
      content: [{ type: 'image', image: webChatAttachmentUrn(attachmentId) }],
    })
    const final = await iterator.next()
    expect(final).toEqual({ done: true, value: undefined })
  })

  it('aborts an in-flight upload immediately when its draft is removed', async () => {
    let uploadSignal: AbortSignal | undefined
    const upload = vi.fn(
      (_file: File, _conversationId: string, signal?: AbortSignal) =>
        new Promise<WebChatAttachmentPreview>((_resolve, reject) => {
          uploadSignal = signal
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          )
        }),
    )
    const remove = vi.fn(async () => undefined)
    const adapter = createWebChatAttachmentAdapter({
      client: {
        upload,
        preview: async () => preview,
        remove,
      },
      getConversationId: async () => conversationId,
      getAttachmentCount: () => 0,
      inspectImage: async () => undefined,
    })
    const iterator = addAttachment(
      adapter,
      new File(['image'], 'cancelled.png', { type: 'image/png' }),
    )
    const first = await iterator.next()

    await expect(adapter.remove(first.value!)).resolves.toBeUndefined()
    expect(uploadSignal?.aborted).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('serializes image history without filenames, Base64, or signed URLs', () => {
    const urn = webChatAttachmentUrn(attachmentId)
    const message = {
      role: 'user',
      createdAt: new Date('2026-07-23T00:00:00Z'),
      metadata: { custom: {} },
      content: [{ type: 'text', text: '分析截图' }],
      attachments: [
        {
          id: attachmentId,
          type: 'image',
          name: 'private-original-name.png',
          contentType: 'image/webp',
          status: { type: 'complete' },
          content: [{ type: 'image', image: urn }],
        },
      ],
      parentId: null,
      sourceId: null,
      runConfig: undefined,
    } satisfies AppendMessage

    const serialized = toWebChatCreateMessage(message)

    expect(serialized).toEqual({
      role: 'user',
      parts: [
        { type: 'text', text: '分析截图' },
        { type: 'file', mediaType: 'image/webp', url: urn },
      ],
      metadata: { custom: {} },
    })
    expect(JSON.stringify(serialized)).not.toContain('private-original-name')
    expect(JSON.stringify(serialized)).not.toContain('signed-preview')
  })
})
