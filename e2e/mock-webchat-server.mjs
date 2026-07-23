import { createServer } from 'node:http'

const host = '127.0.0.1'
const port = 4176
const allowedOrigin = 'http://127.0.0.1:4175'
const encoder = new TextEncoder()
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

let requestCount = 0
let abortedRequests = 0
let activeStreams = 0
let peakConcurrentStreams = 0
let lastRequest = null
let attachmentRequestCount = 0
let attachmentUploadCount = 0
let attachmentPreviewCount = 0
let attachmentRemovalCount = 0
const transientFailures = new Map()
const attachments = new Map()

function cors(origin) {
  return origin === allowedOrigin
    ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': 'retry-after, x-request-id',
        vary: 'Origin',
      }
    : {}
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  return JSON.parse((await readBody(request)).toString('utf8'))
}

async function readBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > 5 * 1024 * 1024) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function messageText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const message = messages.at(-1)
  return Array.isArray(message?.parts)
    ? message.parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
    : ''
}

function event(response, value) {
  response.write(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
}

function streamReply(request, response, chunks, delayMs) {
  const messageId = `mock-${Date.now()}`
  const textId = `${messageId}-text`
  response.writeHead(200, {
    ...cors(request.headers.origin),
    'cache-control': 'private, no-store, no-transform',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-request-id': request.headers['x-request-id'] ?? 'mock-request',
    'x-vercel-ai-ui-message-stream': 'v1',
  })
  event(response, { type: 'start', messageId })
  event(response, { type: 'text-start', id: textId })

  let index = 0
  let timer = null
  let countedAbort = false
  let settled = false
  activeStreams += 1
  peakConcurrentStreams = Math.max(peakConcurrentStreams, activeStreams)
  const settle = () => {
    if (settled) return
    settled = true
    activeStreams = Math.max(0, activeStreams - 1)
  }
  const finish = () => {
    if (response.writableEnded || response.destroyed) return
    event(response, { type: 'text-end', id: textId })
    event(response, { type: 'finish', finishReason: 'stop' })
    settle()
    response.end('data: [DONE]\n\n')
  }
  const writeNext = () => {
    if (response.writableEnded || response.destroyed) return
    const chunk = chunks[index]
    if (chunk === undefined) {
      finish()
      return
    }
    event(response, { type: 'text-delta', id: textId, delta: chunk })
    index += 1
    timer = setTimeout(writeNext, delayMs)
  }
  timer = setTimeout(writeNext, delayMs)

  response.on('close', () => {
    if (timer) clearTimeout(timer)
    settle()
    if (!response.writableEnded && !countedAbort) {
      countedAbort = true
      abortedRequests += 1
    }
  })
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...cors(request.headers.origin),
      'access-control-allow-headers': 'authorization, content-type, apikey, x-request-id',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-max-age': '600',
    })
    response.end()
    return
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true })
    return
  }
  if (request.method === 'GET' && url.pathname.startsWith('/mock-images/')) {
    const attachmentId = url.pathname.slice('/mock-images/'.length).replace(/\.png$/, '')
    if (!attachments.has(attachmentId)) {
      json(response, 404, { error: { code: 'not_found', message: 'Not found' } })
      return
    }
    response.writeHead(200, {
      'cache-control': 'private, max-age=30',
      'content-length': String(tinyPng.byteLength),
      'content-type': 'image/png',
    })
    response.end(tinyPng)
    return
  }
  if (request.method === 'GET' && url.pathname === '/debug') {
    json(response, 200, {
      requestCount,
      abortedRequests,
      activeStreams,
      peakConcurrentStreams,
      lastRequest,
      attachmentRequestCount,
      attachmentUploadCount,
      attachmentPreviewCount,
      attachmentRemovalCount,
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/debug/reset') {
    requestCount = 0
    abortedRequests = 0
    activeStreams = 0
    peakConcurrentStreams = 0
    lastRequest = null
    attachmentRequestCount = 0
    attachmentUploadCount = 0
    attachmentPreviewCount = 0
    attachmentRemovalCount = 0
    transientFailures.clear()
    attachments.clear()
    json(response, 200, { reset: true })
    return
  }
  if (request.method === 'POST' && url.pathname === '/functions/v1/webchat-attachment') {
    if (request.headers.origin !== allowedOrigin) {
      json(response, 403, { error: { code: 'origin_forbidden', message: 'Origin forbidden' } })
      return
    }
    if (request.headers.authorization !== 'Bearer ustsacmland-demo-webchat-token') {
      json(response, 401, { error: { code: 'unauthorized', message: 'Unauthorized' } })
      return
    }

    attachmentRequestCount += 1
    const contentType = String(request.headers['content-type'] ?? '')
    if (contentType.startsWith('multipart/form-data')) {
      await readBody(request)
      attachmentUploadCount += 1
      const suffix = attachmentUploadCount.toString(16).padStart(12, '0')
      const attachmentId = `22222222-2222-4222-8222-${suffix}`
      attachments.set(attachmentId, { status: 'ready' })
      json(
        response,
        201,
        {
          attachment: {
            id: attachmentId,
            mediaType: 'image/webp',
            width: 1,
            height: 1,
            byteSize: tinyPng.byteLength,
            status: 'ready',
            previewUrl: `http://${host}:${port}/mock-images/${attachmentId}.png`,
            expiresIn: 60,
          },
          requestId: request.headers['x-request-id'] ?? 'mock-attachment-request',
        },
        cors(request.headers.origin),
      )
      return
    }

    let action
    try {
      action = await readJson(request)
    } catch {
      json(response, 400, { error: { code: 'invalid_json', message: 'Invalid request' } })
      return
    }
    const attachmentId = typeof action?.attachmentId === 'string' ? action.attachmentId : ''
    if (action?.action === 'preview' && attachments.has(attachmentId)) {
      attachmentPreviewCount += 1
      json(
        response,
        200,
        {
          attachment: {
            id: attachmentId,
            mediaType: 'image/webp',
            width: 1,
            height: 1,
            byteSize: tinyPng.byteLength,
            status: 'attached',
            previewUrl: `http://${host}:${port}/mock-images/${attachmentId}.png`,
            expiresIn: 60,
          },
          requestId: request.headers['x-request-id'] ?? 'mock-attachment-request',
        },
        cors(request.headers.origin),
      )
      return
    }
    if (action?.action === 'remove' && attachments.has(attachmentId)) {
      attachmentRemovalCount += 1
      attachments.delete(attachmentId)
      json(
        response,
        200,
        { removed: true, requestId: request.headers['x-request-id'] ?? 'mock-attachment-request' },
        cors(request.headers.origin),
      )
      return
    }
    json(response, 404, { error: { code: 'attachment_not_found', message: 'Not found' } })
    return
  }
  if (request.method !== 'POST' || url.pathname !== '/api/chat') {
    json(response, 404, { error: { code: 'not_found', message: 'Not found' } })
    return
  }

  if (request.headers.origin !== allowedOrigin) {
    json(response, 403, { error: { code: 'origin_forbidden', message: 'Origin forbidden' } })
    return
  }

  let body
  try {
    body = await readJson(request)
  } catch {
    json(response, 400, { error: { code: 'invalid_json', message: 'Invalid request' } })
    return
  }

  requestCount += 1
  const text = messageText(body)
  const lastMessage = Array.isArray(body.messages) ? body.messages.at(-1) : null
  const fileParts = Array.isArray(lastMessage?.parts)
    ? lastMessage.parts.filter((part) => part?.type === 'file')
    : []
  const requestId = String(request.headers['x-request-id'] ?? '')
  lastRequest = {
    authorizationValid: request.headers.authorization === 'Bearer ustsacmland-demo-webchat-token',
    requestIdValid: /^[0-9a-f-]{36}$/i.test(requestId),
    topLevelFields: Object.keys(body).sort(),
    messageRoles: Array.isArray(body.messages) ? body.messages.map((message) => message?.role) : [],
    fileParts: fileParts.map((part) => ({ mediaType: part.mediaType, url: part.url })),
  }

  const responseHeaders = {
    ...cors(request.headers.origin),
    'x-request-id': requestId || 'mock-request',
  }
  if (text.includes('触发限流')) {
    json(
      response,
      429,
      {
        error: { code: 'chat_minute_limited', message: '发送过于频繁，请稍后再试' },
        requestId: requestId || 'mock-request',
      },
      { ...responseHeaders, 'retry-after': '9' },
    )
    return
  }
  if (text.includes('触发累计额度耗尽')) {
    json(
      response,
      429,
      {
        error: {
          code: 'chat_total_request_limited',
          message: 'AI 助手累计请求次数已用完',
        },
        requestId: requestId || 'mock-request',
      },
      responseHeaders,
    )
    return
  }
  if (text.includes('触发登录失效')) {
    json(
      response,
      401,
      {
        error: { code: 'unauthorized', message: '登录状态已失效，请重新登录。' },
        requestId: requestId || 'mock-request',
      },
      responseHeaders,
    )
    return
  }
  if (text.includes('触发未授权')) {
    json(
      response,
      403,
      {
        error: { code: 'member_access_denied', message: '当前账号不能使用 AI 学习助手。' },
        requestId: requestId || 'mock-request',
      },
      responseHeaders,
    )
    return
  }
  for (const [trigger, status, message] of [
    ['触发网关失败', 502, '中转站暂时不可用，请稍后重试。'],
    ['触发网关超时', 504, '中转站响应超时，请稍后重试。'],
  ]) {
    if (text.includes(trigger) && !transientFailures.has(trigger)) {
      transientFailures.set(trigger, 1)
      json(
        response,
        status,
        {
          error: { code: `upstream_${status}`, message },
          requestId: requestId || 'mock-request',
        },
        responseHeaders,
      )
      return
    }
  }
  if (text.includes('输出长回复')) {
    streamReply(
      request,
      response,
      Array.from({ length: 100 }, (_, index) => `流式片段 ${index + 1}。`),
      45,
    )
    return
  }
  if (text.includes('检查停止前空消息')) {
    streamReply(request, response, ['停止前不应出现正文。'], 10_000)
    return
  }
  if (text.includes('检查思考状态')) {
    streamReply(request, response, ['思考状态结束。'], 500)
    return
  }
  if (text.includes('触发网关失败') || text.includes('触发网关超时')) {
    streamReply(request, response, ['上游连接已经恢复，可以继续提问。'], 20)
    return
  }
  if (text.startsWith('并发会话 ')) {
    const sessionLabel = text.slice('并发会话 '.length)
    streamReply(request, response, [`并发回复 ${sessionLabel}：`, '流式隔离验证完成。'], 160)
    return
  }

  streamReply(request, response, ['先确认边界，', '再验证单调性，', '最后检查复杂度。'], 20)
})

server.listen(port, host, () => {
  console.log(`WebChat E2E mock listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
