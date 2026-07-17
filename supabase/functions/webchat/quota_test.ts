import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict'
import {
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
  dailyRequestLimit: 30,
  dailyTokenLimit: 100_000,
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
        remaining_daily_requests: 29,
        remaining_daily_tokens: 90_000,
        retry_after_seconds: null,
      },
    ]),
    {
      decision: 'acquired',
      status: 'claimed',
      remainingMinuteRequests: 2,
      remainingDailyRequests: 29,
      remainingDailyTokens: 90_000,
      retryAfterSeconds: null,
    },
  )

  throws(
    () =>
      parseWebChatClaimResult({
        decision: 'allow_everything',
        status: 'claimed',
        remaining_minute_requests: 1,
        remaining_daily_requests: 1,
        remaining_daily_tokens: 1,
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
        usage: { input_tokens: 20, output_tokens: 11, total_tokens: 31 },
      },
    }),
    { inputTokens: 20, outputTokens: 11, totalTokens: 31 },
  )
})

Deno.test('webchat quota rejects missing or inconsistent trusted usage', () => {
  for (const event of [
    { response: {} },
    { response: { usage: { input_tokens: 20, output_tokens: 11, total_tokens: 30 } } },
  ]) {
    try {
      parseWebChatUsage(event)
      throw new Error('expected invalid usage')
    } catch (error) {
      match(String(error), /invalid|inconsistent/)
    }
  }
})
