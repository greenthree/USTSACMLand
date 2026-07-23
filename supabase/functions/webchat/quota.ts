import { promptCacheOptions } from './upstream.ts'

export interface WebChatQuotaImage {
  attachmentId: string
  mediaType?: string
  url?: string
  width?: number
  height?: number
}

export interface WebChatQuotaMessage {
  id?: string
  role: 'user' | 'assistant'
  text: string
  images?: WebChatQuotaImage[]
}

export interface WebChatQuotaPolicy {
  model: string
  systemPrompt: string
  promptVersion: string
  maxOutputTokens: number
  minuteRequestLimit: number
  memberTotalRequestLimit: number
  memberTotalTokenLimit: number
  leaseSeconds: number
}

export interface WebChatQuotaPreparation {
  fingerprint: string
  reservedTokens: number
}

export type WebChatClaimDecision =
  | 'acquired'
  | 'member_access_denied'
  | 'request_token_limited'
  | 'requests_disabled'
  | 'active_concurrent'
  | 'minute_limited'
  | 'member_total_request_limited'
  | 'member_total_token_limited'
  | 'global_daily_request_limited'
  | 'global_daily_token_limited'
  | 'duplicate_active'
  | 'duplicate_terminal'
  | 'idempotency_conflict'

export interface WebChatClaimResult {
  decision: WebChatClaimDecision
  status: string
  remainingMinuteRequests: number
  remainingTotalRequests: number
  remainingTotalTokens: number
  retryAfterSeconds: number | null
}

export interface WebChatUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number | null
  cacheWriteTokens: number | null
}

export interface WebChatBudgetAlertClaim {
  shouldNotify: boolean
  budgetKind: 'requests' | 'tokens'
  usageDate: string
  budgetLimit: number
  requestCount: number
  settledTokens: number
  reservedTokens: number
  attemptedReservedTokens: number
  observedUsage: number
  observedAt: string
  resetAt: string
}

const encoder = new TextEncoder()
export const WEBCHAT_IMAGE_PATCH_SIZE = 32
export const WEBCHAT_IMAGE_TOKENS_PER_PATCH = 4
export const WEBCHAT_IMAGE_FRAME_TOKENS = 256
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/
const CLAIM_DECISIONS = new Set<WebChatClaimDecision>([
  'acquired',
  'member_access_denied',
  'request_token_limited',
  'requests_disabled',
  'active_concurrent',
  'minute_limited',
  'member_total_request_limited',
  'member_total_token_limited',
  'global_daily_request_limited',
  'global_daily_token_limited',
  'duplicate_active',
  'duplicate_terminal',
  'idempotency_conflict',
])

function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`WebChat quota RPC returned an invalid ${name}`)
  }
  return value
}

function nullableNonnegativeInteger(value: unknown, name: string): number | null {
  return value === null ? null : nonnegativeInteger(value, name)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('WebChat quota RPC returned an invalid row')
  }
  return value as Record<string, unknown>
}

/**
 * Reserve a deliberately conservative amount for high-detail image input.
 * The relay's final usage remains authoritative; this only protects the
 * member/global reservation fences before an upstream request starts.
 */
export function estimateWebChatImageTokens(image: { width?: number; height?: number }): number {
  const width =
    typeof image.width === 'number' && Number.isSafeInteger(image.width) && image.width > 0
      ? image.width
      : 2_048
  const height =
    typeof image.height === 'number' && Number.isSafeInteger(image.height) && image.height > 0
      ? image.height
      : 2_048
  const patches =
    Math.ceil(width / WEBCHAT_IMAGE_PATCH_SIZE) * Math.ceil(height / WEBCHAT_IMAGE_PATCH_SIZE)
  const tokens = WEBCHAT_IMAGE_FRAME_TOKENS + patches * WEBCHAT_IMAGE_TOKENS_PER_PATCH
  if (!Number.isSafeInteger(tokens) || tokens < 1) {
    throw new Error('WebChat image token reservation is invalid')
  }
  return tokens
}

function billableInput(messages: WebChatQuotaMessage[], policy: WebChatQuotaPolicy): string {
  const cacheOptions = promptCacheOptions(policy.model)
  return JSON.stringify({
    model: policy.model,
    instructions: policy.systemPrompt,
    promptVersion: policy.promptVersion,
    // Keep image identity stable without persisting URLs, object keys, hashes,
    // dimensions, or any other attachment metadata in the fingerprint.
    input: messages.map(({ role, text, images }) => ({
      role,
      content: text,
      images: (images ?? []).map(({ attachmentId }) => attachmentId),
    })),
    maxOutputTokens: policy.maxOutputTokens,
    ...(cacheOptions ? { prompt_cache_options: cacheOptions } : {}),
    store: false,
  })
}

export async function prepareWebChatQuota(
  messages: WebChatQuotaMessage[],
  policy: WebChatQuotaPolicy,
): Promise<WebChatQuotaPreparation> {
  const serialized = billableInput(messages, policy)
  const bytes = encoder.encode(serialized)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  const imageTokens = messages.reduce(
    (total, message) =>
      total +
      (message.images ?? []).reduce(
        (messageTotal, image) => messageTotal + estimateWebChatImageTokens(image),
        0,
      ),
    0,
  )
  // Each input token consumes at least one encoded byte. The fixed allowance
  // covers provider framing that is not represented by the JSON payload. Image
  // patches are added separately because their bytes are intentionally absent
  // from the quota fingerprint.
  const reservedTokens = bytes.byteLength + imageTokens + policy.maxOutputTokens + 1_024
  if (!Number.isSafeInteger(reservedTokens) || reservedTokens < 1) {
    throw new Error('WebChat token reservation is invalid')
  }
  return { fingerprint, reservedTokens }
}

export function parseWebChatClaimResult(value: unknown): WebChatClaimResult {
  const row = asRecord(Array.isArray(value) ? value[0] : value)
  if (
    typeof row.decision !== 'string' ||
    !CLAIM_DECISIONS.has(row.decision as WebChatClaimDecision)
  ) {
    throw new Error('WebChat quota RPC returned an invalid decision')
  }
  if (typeof row.status !== 'string' || row.status.length < 1 || row.status.length > 32) {
    throw new Error('WebChat quota RPC returned an invalid status')
  }

  return {
    decision: row.decision as WebChatClaimDecision,
    status: row.status,
    remainingMinuteRequests: nonnegativeInteger(row.remaining_minute_requests, 'minute allowance'),
    remainingTotalRequests: nonnegativeInteger(
      row.remaining_total_requests,
      'total request allowance',
    ),
    remainingTotalTokens: nonnegativeInteger(row.remaining_total_tokens, 'total token allowance'),
    retryAfterSeconds: nullableNonnegativeInteger(row.retry_after_seconds, 'retry delay'),
  }
}

export function parseWebChatTransition(value: unknown): {
  transitioned: boolean
  status: string
  chargedTokens: number
} {
  const row = asRecord(Array.isArray(value) ? value[0] : value)
  if (typeof row.transitioned !== 'boolean' || typeof row.status !== 'string') {
    throw new Error('WebChat quota transition returned an invalid result')
  }
  return {
    transitioned: row.transitioned,
    status: row.status,
    chargedTokens: nonnegativeInteger(row.charged_tokens, 'charged token count'),
  }
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`WebChat budget alert RPC returned an invalid ${name}`)
  }
  return value
}

export function parseWebChatBudgetAlertClaim(value: unknown): WebChatBudgetAlertClaim {
  const row = asRecord(Array.isArray(value) ? value[0] : value)
  if (
    typeof row.should_notify !== 'boolean' ||
    (row.budget_kind !== 'requests' && row.budget_kind !== 'tokens') ||
    typeof row.usage_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.usage_date)
  ) {
    throw new Error('WebChat budget alert RPC returned invalid data')
  }

  return {
    shouldNotify: row.should_notify,
    budgetKind: row.budget_kind,
    usageDate: row.usage_date,
    budgetLimit: nonnegativeInteger(row.budget_limit, 'budget limit'),
    requestCount: nonnegativeInteger(row.request_count, 'global request count'),
    settledTokens: nonnegativeInteger(row.settled_tokens, 'global settled tokens'),
    reservedTokens: nonnegativeInteger(row.reserved_tokens, 'global reserved tokens'),
    attemptedReservedTokens: nonnegativeInteger(
      row.attempted_reserved_tokens,
      'attempted token reservation',
    ),
    observedUsage: nonnegativeInteger(row.observed_usage, 'observed global usage'),
    observedAt: timestamp(row.observed_at, 'observation timestamp'),
    resetAt: timestamp(row.reset_at, 'reset timestamp'),
  }
}

export function parseWebChatUsage(event: Record<string, unknown>): WebChatUsage {
  const response = asRecord(event.response)
  const usage = asRecord(response.usage)
  const inputTokenDetails =
    usage.input_tokens_details === undefined || usage.input_tokens_details === null
      ? null
      : asRecord(usage.input_tokens_details)
  const inputTokens = nonnegativeInteger(usage.input_tokens, 'input token usage')
  const outputTokens = nonnegativeInteger(usage.output_tokens, 'output token usage')
  const totalTokens = nonnegativeInteger(usage.total_tokens, 'total token usage')
  const cachedInputTokens =
    inputTokenDetails?.cached_tokens === undefined || inputTokenDetails.cached_tokens === null
      ? null
      : nonnegativeInteger(inputTokenDetails.cached_tokens, 'cached input token usage')
  const cacheWriteTokens =
    inputTokenDetails?.cache_write_tokens === undefined ||
    inputTokenDetails.cache_write_tokens === null
      ? null
      : nonnegativeInteger(inputTokenDetails.cache_write_tokens, 'cache write token usage')
  if (totalTokens !== inputTokens + outputTokens) {
    throw new Error('WebChat upstream returned inconsistent token usage')
  }
  if (cachedInputTokens !== null && cachedInputTokens > inputTokens) {
    throw new Error('WebChat upstream returned inconsistent cached token usage')
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheWriteTokens,
  }
}

export function assertFingerprint(value: string): void {
  if (!FINGERPRINT_PATTERN.test(value)) {
    throw new Error('WebChat request fingerprint is invalid')
  }
}
