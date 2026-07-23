export const DEFAULT_MAX_REQUEST_BYTES = 262_144
export const DEFAULT_MAX_MESSAGES = 40
export const DEFAULT_MAX_MESSAGE_CHARS = 12_000
export const DEFAULT_MAX_TOTAL_CHARS = 60_000
export const DEFAULT_MAX_TOTAL_IMAGES = 12

export type WebChatTrigger = 'submit-message' | 'regenerate-message'

export interface NormalizedWebChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images: NormalizedWebChatImageReference[]
}

export interface NormalizedWebChatImageReference {
  attachmentId: string
  urn: string
}

export interface WebChatRequest {
  chatId: string | null
  trigger: WebChatTrigger | null
  messageId: string | null
  messages: NormalizedWebChatMessage[]
}

export type RequestValidationErrorCode =
  'unsupported_media_type' | 'request_body_too_large' | 'invalid_json' | 'invalid_request'

export class RequestValidationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: RequestValidationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

export interface WebChatRequestLimits {
  maxBodyBytes?: number
  maxMessages?: number
  maxMessageChars?: number
  maxTotalChars?: number
  maxTotalImages?: number
}

interface ResolvedLimits {
  maxBodyBytes: number
  maxMessages: number
  maxMessageChars: number
  maxTotalChars: number
  maxTotalImages: number
}

const TOP_LEVEL_FIELDS = new Set(['id', 'messages', 'trigger', 'messageId'])
const MESSAGE_FIELDS = new Set(['id', 'role', 'parts'])
const TEXT_PART_FIELDS = new Set(['type', 'text', 'state', 'providerMetadata'])
const FILE_PART_FIELDS = new Set(['type', 'mediaType', 'url'])
const TRIGGERS = new Set<WebChatTrigger>(['submit-message', 'regenerate-message'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ATTACHMENT_URN_PATTERN =
  /^urn:ustsacm:webchat-attachment:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

function invalid(message: string): never {
  throw new RequestValidationError(400, 'invalid_request', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) invalid(`${location} contains unsupported field "${unknown}"`)
}

function resolvePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return resolved
}

function resolveLimits(limits: WebChatRequestLimits): ResolvedLimits {
  return {
    maxBodyBytes: resolvePositiveInteger(
      limits.maxBodyBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      'maxBodyBytes',
    ),
    maxMessages: resolvePositiveInteger(limits.maxMessages, DEFAULT_MAX_MESSAGES, 'maxMessages'),
    maxMessageChars: resolvePositiveInteger(
      limits.maxMessageChars,
      DEFAULT_MAX_MESSAGE_CHARS,
      'maxMessageChars',
    ),
    maxTotalChars: resolvePositiveInteger(
      limits.maxTotalChars,
      DEFAULT_MAX_TOTAL_CHARS,
      'maxTotalChars',
    ),
    maxTotalImages: resolvePositiveInteger(
      limits.maxTotalImages,
      DEFAULT_MAX_TOTAL_IMAGES,
      'maxTotalImages',
    ),
  }
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type')
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new RequestValidationError(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json',
    )
  }
}

async function readRequestBytes(request: Request, maxBodyBytes: number): Promise<Uint8Array> {
  if (!request.body) invalid('Request body is required')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      byteLength += value.byteLength
      if (byteLength > maxBodyBytes) {
        try {
          await reader.cancel('request_body_too_large')
        } catch {
          // Cancellation is best-effort; the public result must remain a stable 413.
        }
        throw new RequestValidationError(
          413,
          'request_body_too_large',
          `Request body exceeds ${maxBodyBytes} bytes`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function decodeJson(bytes: Uint8Array): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new RequestValidationError(400, 'invalid_json', 'Request body must be valid UTF-8 JSON')
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new RequestValidationError(400, 'invalid_json', 'Request body must be valid JSON')
  }
}

function parseOptionalId(value: unknown, field: string): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') {
    invalid(`${field} must be a string when provided`)
  }

  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > 128) {
    invalid(`${field} must contain between 1 and 128 characters`)
  }
  return normalized
}

function characterCount(value: string): number {
  return Array.from(value).length
}

function parseMessage(
  value: unknown,
  index: number,
  maxMessageChars: number,
): { message: NormalizedWebChatMessage; chars: number } {
  const location = `messages[${index}]`
  if (!isRecord(value)) invalid(`${location} must be an object`)
  rejectUnknownFields(value, MESSAGE_FIELDS, location)

  const id = parseOptionalId(value.id, `${location}.id`)
  if (id === null) invalid(`${location}.id is required`)

  const role = value.role
  if (role !== 'user' && role !== 'assistant') {
    invalid(`${location}.role must be "user" or "assistant"`)
  }

  if (!Array.isArray(value.parts) || value.parts.length < 1) {
    invalid(`${location}.parts must contain at least one text part`)
  }

  const texts: string[] = []
  const images: NormalizedWebChatImageReference[] = []
  for (const [partIndex, part] of value.parts.entries()) {
    const partLocation = `${location}.parts[${partIndex}]`
    if (!isRecord(part)) invalid(`${partLocation} must be an object`)
    if (part.type === 'text') {
      rejectUnknownFields(part, TEXT_PART_FIELDS, partLocation)
      if (typeof part.text !== 'string' || characterCount(part.text) < 1) {
        invalid(`${partLocation}.text must be a non-empty string`)
      }
      if (part.state !== undefined && part.state !== 'streaming' && part.state !== 'done') {
        invalid(`${partLocation}.state is invalid`)
      }
      if (part.providerMetadata !== undefined && !isRecord(part.providerMetadata)) {
        invalid(`${partLocation}.providerMetadata must be an object when provided`)
      }
      texts.push(part.text)
      continue
    }
    if (part.type === 'file') {
      rejectUnknownFields(part, FILE_PART_FIELDS, partLocation)
      if (role !== 'user') invalid(`${partLocation} is only allowed in user messages`)
      if (part.mediaType !== 'image/webp' || typeof part.url !== 'string') {
        invalid(`${partLocation} must use the normalized WebChat image protocol`)
      }
      const match = ATTACHMENT_URN_PATTERN.exec(part.url)
      if (!match) invalid(`${partLocation}.url must be a WebChat attachment URN`)
      const attachmentId = match[1]!.toLowerCase()
      if (images.some((image) => image.attachmentId === attachmentId)) {
        invalid(`${partLocation} duplicates an image attachment`)
      }
      images.push({ attachmentId, urn: `urn:ustsacm:webchat-attachment:${attachmentId}` })
      if (images.length > 4) invalid(`${location} may contain at most four images`)
      continue
    }
    invalid(`${partLocation} must be a text or normalized image part`)
  }

  const text = texts.join('\n')
  const chars = characterCount(text)
  if (text.trim().length < 1 && images.length === 0) {
    invalid(`${location} must contain non-whitespace text or an image`)
  }
  if (chars > maxMessageChars) {
    invalid(`${location} exceeds the ${maxMessageChars} character limit`)
  }

  return { message: { id, role, text, images }, chars }
}

function normalizePayload(value: unknown, limits: ResolvedLimits): WebChatRequest {
  if (!isRecord(value)) invalid('Request body must be a JSON object')
  rejectUnknownFields(value, TOP_LEVEL_FIELDS, 'Request body')

  if (!Array.isArray(value.messages)) invalid('messages must be an array')
  if (value.messages.length < 1 || value.messages.length > limits.maxMessages) {
    invalid(`messages must contain between 1 and ${limits.maxMessages} items`)
  }

  const chatId = parseOptionalId(value.id, 'id')
  let totalChars = 0
  const seenAttachmentIds = new Set<string>()
  const messages = value.messages.map((message, index) => {
    const parsed = parseMessage(message, index, limits.maxMessageChars)
    totalChars += parsed.chars
    if (totalChars > limits.maxTotalChars) {
      invalid(`Message text exceeds the ${limits.maxTotalChars} total character limit`)
    }
    for (const image of parsed.message.images) {
      if (seenAttachmentIds.has(image.attachmentId)) {
        invalid('An image attachment cannot appear in more than one message')
      }
      seenAttachmentIds.add(image.attachmentId)
      if (seenAttachmentIds.size > limits.maxTotalImages) {
        invalid(`Request may contain at most ${limits.maxTotalImages} images`)
      }
    }
    return parsed.message
  })

  if (seenAttachmentIds.size > 0 && (!chatId || !UUID_PATTERN.test(chatId))) {
    invalid('Image messages require a persisted conversation UUID')
  }

  if (messages.at(-1)?.role !== 'user') {
    invalid('The final message must have role "user"')
  }

  let trigger: WebChatTrigger | null = null
  if (value.trigger !== undefined) {
    if (typeof value.trigger !== 'string' || !TRIGGERS.has(value.trigger as WebChatTrigger)) {
      invalid('trigger must be "submit-message" or "regenerate-message" when provided')
    }
    trigger = value.trigger as WebChatTrigger
  }

  return {
    chatId,
    trigger,
    messageId: parseOptionalId(value.messageId, 'messageId'),
    messages,
  }
}

export async function parseWebChatRequest(
  request: Request,
  limits: WebChatRequestLimits = {},
): Promise<WebChatRequest> {
  assertJsonContentType(request)
  const resolvedLimits = resolveLimits(limits)
  const bytes = await readRequestBytes(request, resolvedLimits.maxBodyBytes)
  return normalizePayload(decodeJson(bytes), resolvedLimits)
}
