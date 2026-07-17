import type { WebChatMessage } from './upstream.ts'

export interface WebChatQuotaPolicy {
  model: string
  systemPrompt: string
  promptVersion: string
  maxOutputTokens: number
  minuteRequestLimit: number
  dailyRequestLimit: number
  dailyTokenLimit: number
  leaseSeconds: number
}

export interface WebChatQuotaPreparation {
  fingerprint: string
  reservedTokens: number
}

export type WebChatClaimDecision =
  | 'acquired'
  | 'active_concurrent'
  | 'minute_limited'
  | 'daily_request_limited'
  | 'daily_token_limited'
  | 'duplicate_active'
  | 'duplicate_terminal'
  | 'idempotency_conflict'

export interface WebChatClaimResult {
  decision: WebChatClaimDecision
  status: string
  remainingMinuteRequests: number
  remainingDailyRequests: number
  remainingDailyTokens: number
  retryAfterSeconds: number | null
}

export interface WebChatUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const encoder = new TextEncoder()
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/
const CLAIM_DECISIONS = new Set<WebChatClaimDecision>([
  'acquired',
  'active_concurrent',
  'minute_limited',
  'daily_request_limited',
  'daily_token_limited',
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

function billableInput(messages: WebChatMessage[], policy: WebChatQuotaPolicy): string {
  return JSON.stringify({
    model: policy.model,
    instructions: policy.systemPrompt,
    promptVersion: policy.promptVersion,
    input: messages.map(({ role, text }) => ({ role, content: text })),
    maxOutputTokens: policy.maxOutputTokens,
    store: false,
  })
}

export async function prepareWebChatQuota(
  messages: WebChatMessage[],
  policy: WebChatQuotaPolicy,
): Promise<WebChatQuotaPreparation> {
  const serialized = billableInput(messages, policy)
  const bytes = encoder.encode(serialized)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  // Each input token consumes at least one encoded byte. The fixed allowance
  // covers provider framing that is not represented by the JSON payload.
  const reservedTokens = bytes.byteLength + policy.maxOutputTokens + 1_024
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
    remainingDailyRequests: nonnegativeInteger(
      row.remaining_daily_requests,
      'daily request allowance',
    ),
    remainingDailyTokens: nonnegativeInteger(row.remaining_daily_tokens, 'daily token allowance'),
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

export function parseWebChatUsage(event: Record<string, unknown>): WebChatUsage {
  const response = asRecord(event.response)
  const usage = asRecord(response.usage)
  const inputTokens = nonnegativeInteger(usage.input_tokens, 'input token usage')
  const outputTokens = nonnegativeInteger(usage.output_tokens, 'output token usage')
  const totalTokens = nonnegativeInteger(usage.total_tokens, 'total token usage')
  if (totalTokens !== inputTokens + outputTokens) {
    throw new Error('WebChat upstream returned inconsistent token usage')
  }
  return { inputTokens, outputTokens, totalTokens }
}

export function assertFingerprint(value: string): void {
  if (!FINGERPRINT_PATTERN.test(value)) {
    throw new Error('WebChat request fingerprint is invalid')
  }
}
