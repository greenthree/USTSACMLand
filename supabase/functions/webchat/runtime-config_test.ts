import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict'
import { resolveWebChatRelayRuntimeConfig } from './runtime-config.ts'

const fallback = {
  baseUrl: 'https://environment.example.test/v1',
  apiKey: 'environment-secret',
  model: 'environment-model',
  requestsEnabled: true,
  globalDailyRequestLimit: 300,
  globalDailyTokenLimit: 1_000_000,
}

Deno.test('webchat runtime configuration prefers a complete database relay', () => {
  let fallbacks = 0
  const result = resolveWebChatRelayRuntimeConfig(
    [
      {
        base_url: ' https://database.example.test/v1 ',
        api_key: ' database-secret ',
        model: ' database-model ',
        requests_enabled: false,
        global_daily_request_limit: 400,
        global_daily_token_limit: 1_200_000,
        version: 9,
      },
    ],
    () => {
      fallbacks += 1
      return fallback
    },
  )

  deepStrictEqual(result, {
    baseUrl: 'https://database.example.test/v1',
    apiKey: 'database-secret',
    model: 'database-model',
    requestsEnabled: false,
    globalDailyRequestLimit: 400,
    globalDailyTokenLimit: 1_200_000,
  })
  strictEqual(fallbacks, 0)
})

Deno.test('webchat runtime configuration falls back only when the database row is absent', () => {
  for (const value of [null, []]) {
    deepStrictEqual(
      resolveWebChatRelayRuntimeConfig(value, () => fallback),
      fallback,
    )
  }
})

Deno.test('webchat runtime configuration keeps an incomplete database row paused', () => {
  let fallbacks = 0
  const result = resolveWebChatRelayRuntimeConfig(
    [
      {
        base_url: null,
        api_key: null,
        model: null,
        requests_enabled: false,
        global_daily_request_limit: 123,
        global_daily_token_limit: 456_000,
      },
    ],
    () => {
      fallbacks += 1
      return fallback
    },
  )

  deepStrictEqual(result, {
    baseUrl: '',
    apiKey: '',
    model: '',
    requestsEnabled: false,
    globalDailyRequestLimit: 123,
    globalDailyTokenLimit: 456_000,
  })
  strictEqual(fallbacks, 0)
})

Deno.test(
  'webchat runtime configuration fails closed when an enabled database row is incomplete',
  () => {
    let fallbacks = 0
    throws(
      () =>
        resolveWebChatRelayRuntimeConfig(
          [
            {
              base_url: 'https://database.example.test/v1',
              api_key: null,
              model: 'gpt-5.6',
              requests_enabled: true,
              global_daily_request_limit: 300,
              global_daily_token_limit: 1_000_000,
            },
          ],
          () => {
            fallbacks += 1
            return fallback
          },
        ),
      /incomplete/,
    )
    strictEqual(fallbacks, 0)
  },
)

Deno.test('webchat runtime configuration rejects malformed RPC containers', () => {
  for (const value of [
    'secret-string',
    [
      {
        base_url: 42,
        api_key: 'secret',
        model: 'gpt-5.6',
        requests_enabled: false,
        global_daily_request_limit: 300,
        global_daily_token_limit: 1_000_000,
      },
    ],
  ]) {
    throws(() => resolveWebChatRelayRuntimeConfig(value, () => fallback), /invalid data/)
  }
})
