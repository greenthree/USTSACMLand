import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict'
import {
  parseWebChatGlobalBudgetUsageView,
  parseWebChatRelayConfigView,
  retryAfterFromDatabaseError,
} from './config.ts'

Deno.test('webchat config parser exposes only redacted relay metadata', () => {
  const source = {
    base_url: 'https://relay.example.test/v1',
    model: 'gpt-5.6',
    api_key_configured: true,
    requests_enabled: false,
    global_daily_request_limit: 300,
    global_daily_token_limit: 1_000_000,
    version: 7,
    updated_at: '2026-07-17T08:00:00.000Z',
    api_key: 'must-never-be-returned',
  }

  deepStrictEqual(parseWebChatRelayConfigView([source]), {
    baseUrl: 'https://relay.example.test/v1',
    model: 'gpt-5.6',
    apiKeyConfigured: true,
    requestsEnabled: false,
    globalDailyRequestLimit: 300,
    globalDailyTokenLimit: 1_000_000,
    version: 7,
    updatedAt: '2026-07-17T08:00:00.000Z',
  })
})

Deno.test('webchat config parser rejects malformed database rows', () => {
  for (const value of [null, [], {}, { base_url: null, model: null }]) {
    throws(() => parseWebChatRelayConfigView(value), /invalid/)
  }
})

Deno.test('webchat config parser maps the unconfigured singleton to empty form values', () => {
  deepStrictEqual(
    parseWebChatRelayConfigView({
      base_url: null,
      model: null,
      api_key_configured: false,
      requests_enabled: false,
      global_daily_request_limit: 300,
      global_daily_token_limit: 1_000_000,
      version: 0,
      updated_at: '2026-07-17T08:00:00.000Z',
    }),
    {
      baseUrl: '',
      model: '',
      apiKeyConfigured: false,
      requestsEnabled: false,
      globalDailyRequestLimit: 300,
      globalDailyTokenLimit: 1_000_000,
      version: 0,
      updatedAt: '2026-07-17T08:00:00.000Z',
    },
  )
})

Deno.test('webchat config parser exposes aggregate Beijing daily usage', () => {
  deepStrictEqual(
    parseWebChatGlobalBudgetUsageView([
      {
        usage_date: '2026-07-17',
        request_count: 28,
        settled_tokens: 940_000,
        reserved_tokens: 40_000,
        reset_at: '2026-07-17T16:00:00.000Z',
        request_budget_alerted_at: null,
        token_budget_alerted_at: '2026-07-17T10:00:00.000Z',
      },
    ]),
    {
      usageDate: '2026-07-17',
      requestCount: 28,
      settledTokens: 940_000,
      reservedTokens: 40_000,
      resetAt: '2026-07-17T16:00:00.000Z',
      requestBudgetAlertedAt: null,
      tokenBudgetAlertedAt: '2026-07-17T10:00:00.000Z',
    },
  )

  for (const value of [
    null,
    { usage_date: 'invalid' },
    {
      usage_date: '2026-07-17',
      request_count: -1,
      settled_tokens: 0,
      reserved_tokens: 0,
      reset_at: '2026-07-17T16:00:00.000Z',
      request_budget_alerted_at: null,
      token_budget_alerted_at: null,
    },
  ]) {
    throws(() => parseWebChatGlobalBudgetUsageView(value), /invalid/)
  }
})

Deno.test('webchat config rate-limit details are bounded to a safe retry delay', () => {
  strictEqual(retryAfterFromDatabaseError('{"retry_after_seconds":17.2}'), 18)
  strictEqual(retryAfterFromDatabaseError('{"retry_after_seconds":"9"}'), 9)
  strictEqual(retryAfterFromDatabaseError('{"retry_after_seconds":-1}'), 60)
  strictEqual(retryAfterFromDatabaseError('not-json'), 60)
  strictEqual(retryAfterFromDatabaseError(null), 60)
})
