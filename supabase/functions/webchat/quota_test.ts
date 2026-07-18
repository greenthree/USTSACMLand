import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict'
import {
  parseWebChatBudgetAlertClaim,
  parseWebChatClaimResult,
  parseWebChatTransition,
  parseWebChatUsage,
  prepareWebChatQuota,
  type WebChatQuotaPolicy,
} from './quota.ts'

const policy: WebChatQuotaPolicy = {
  model: 'gpt-5.6',
  systemPrompt: 'Server-owned prompt',
  promptVersion: 'prompt-v1',
  maxOutputTokens: 2_048,
  minuteRequestLimit: 3,
  memberTotalRequestLimit: 30,
  memberTotalTokenLimit: 100_000,
  leaseSeconds: 180,
}

Deno.test('webchat quota fingerprints normalized billable input without storing it', async () => {
  const first = await prepareWebChatQuota(
    [{ id: 'one', role: 'user', text: '解释二分答案' }],
    policy,
  )
  const same = await prepareWebChatQuota(
    [{ id: 'different-client-id', role: 'user', text: '解释二分答案' }],
    policy,
  )
  const changed = await prepareWebChatQuota(
    [{ id: 'one', role: 'user', text: '解释最短路' }],
    policy,
  )

  match(first.fingerprint, /^[a-f0-9]{64}$/)
  strictEqual(first.fingerprint, same.fingerprint)
  strictEqual(first.fingerprint === changed.fingerprint, false)
  strictEqual(first.reservedTokens > policy.maxOutputTokens, true)
})

Deno.test('webchat quota fingerprint includes server-owned model and prompt versions', async () => {
  const messages = [{ id: 'one', role: 'user' as const, text: 'hello' }]
  const first = await prepareWebChatQuota(messages, policy)
  const changedModel = await prepareWebChatQuota(messages, { ...policy, model: 'gpt-5.6-new' })
  const changedPrompt = await prepareWebChatQuota(messages, {
    ...policy,
    promptVersion: 'prompt-v2',
  })

  strictEqual(first.fingerprint === changedModel.fingerprint, false)
  strictEqual(first.fingerprint === changedPrompt.fingerprint, false)
})

Deno.test('webchat quota parses only known database decisions', () => {
  deepStrictEqual(
    parseWebChatClaimResult([
      {
        decision: 'acquired',
        status: 'claimed',
        remaining_minute_requests: 2,
        remaining_total_requests: 29,
        remaining_total_tokens: 90_000,
        retry_after_seconds: null,
      },
    ]),
    {
      decision: 'acquired',
      status: 'claimed',
      remainingMinuteRequests: 2,
      remainingTotalRequests: 29,
      remainingTotalTokens: 90_000,
      retryAfterSeconds: null,
    },
  )

  throws(
    () =>
      parseWebChatClaimResult({
        decision: 'allow_everything',
        status: 'claimed',
        remaining_minute_requests: 1,
        remaining_total_requests: 1,
        remaining_total_tokens: 1,
        retry_after_seconds: null,
      }),
    /invalid decision/,
  )
})

Deno.test('webchat quota parses fenced transition and trusted Responses usage', () => {
  deepStrictEqual(
    parseWebChatTransition([{ transitioned: true, status: 'finished', charged_tokens: 31 }]),
    { transitioned: true, status: 'finished', chargedTokens: 31 },
  )
  deepStrictEqual(
    parseWebChatUsage({
      response: {
        usage: {
          input_tokens: 20,
          output_tokens: 11,
          total_tokens: 31,
          input_tokens_details: { cached_tokens: 16, cache_write_tokens: 4 },
        },
      },
    }),
    {
      inputTokens: 20,
      outputTokens: 11,
      totalTokens: 31,
      cachedInputTokens: 16,
      cacheWriteTokens: 4,
    },
  )
  deepStrictEqual(
    parseWebChatUsage({
      response: {
        usage: { input_tokens: 20, output_tokens: 11, total_tokens: 31 },
      },
    }),
    {
      inputTokens: 20,
      outputTokens: 11,
      totalTokens: 31,
      cachedInputTokens: null,
      cacheWriteTokens: null,
    },
  )
})

Deno.test('webchat quota parses only aggregate budget alert claims', () => {
  deepStrictEqual(
    parseWebChatBudgetAlertClaim([
      {
        should_notify: true,
        budget_kind: 'tokens',
        usage_date: '2026-07-17',
        budget_limit: 1_000_000,
        request_count: 28,
        settled_tokens: 940_000,
        reserved_tokens: 40_000,
        attempted_reserved_tokens: 21_024,
        observed_usage: 1_001_024,
        observed_at: '2026-07-17T10:00:00.000Z',
        reset_at: '2026-07-17T16:00:00.000Z',
      },
    ]),
    {
      shouldNotify: true,
      budgetKind: 'tokens',
      usageDate: '2026-07-17',
      budgetLimit: 1_000_000,
      requestCount: 28,
      settledTokens: 940_000,
      reservedTokens: 40_000,
      attemptedReservedTokens: 21_024,
      observedUsage: 1_001_024,
      observedAt: '2026-07-17T10:00:00.000Z',
      resetAt: '2026-07-17T16:00:00.000Z',
    },
  )

  for (const row of [
    { budget_kind: 'messages' },
    { budget_kind: 'tokens', usage_date: 'invalid' },
  ]) {
    throws(
      () =>
        parseWebChatBudgetAlertClaim({
          should_notify: false,
          usage_date: '2026-07-17',
          budget_limit: 1,
          request_count: 0,
          settled_tokens: 0,
          reserved_tokens: 0,
          attempted_reserved_tokens: 0,
          observed_usage: 0,
          observed_at: '2026-07-17T10:00:00.000Z',
          reset_at: '2026-07-17T16:00:00.000Z',
          ...row,
        }),
      /invalid/,
    )
  }
})

Deno.test('webchat quota rejects missing or inconsistent trusted usage', () => {
  for (const event of [
    { response: {} },
    { response: { usage: { input_tokens: 20, output_tokens: 11, total_tokens: 30 } } },
    {
      response: {
        usage: {
          input_tokens: 20,
          output_tokens: 11,
          total_tokens: 31,
          input_tokens_details: { cached_tokens: 21 },
        },
      },
    },
    {
      response: {
        usage: {
          input_tokens: 20,
          output_tokens: 11,
          total_tokens: 31,
          input_tokens_details: { cache_write_tokens: -1 },
        },
      },
    },
  ]) {
    try {
      parseWebChatUsage(event)
      throw new Error('expected invalid usage')
    } catch (error) {
      match(String(error), /invalid|inconsistent/)
    }
  }
})
