// deno-lint-ignore-file require-await
import { deepStrictEqual, match, rejects, strictEqual } from 'node:assert/strict'
import {
  cacheProbeReservationTokens,
  CacheProbeError,
  parseCacheProbeUsage,
  runCacheProbe,
  type CacheProbeRuntimeConfig,
} from './probe.ts'

function jsonResponse(cachedTokens: number, cacheWriteTokens: number | null = null): Response {
  return new Response(
    JSON.stringify({
      model: 'gpt-5.6',
      usage: {
        input_tokens: 1_600,
        output_tokens: 1,
        total_tokens: 1_601,
        input_tokens_details: {
          cached_tokens: cachedTokens,
          ...(cacheWriteTokens === null ? {} : { cache_write_tokens: cacheWriteTokens }),
        },
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

Deno.test(
  'cache probe derives a conservative two-request reservation from encoded bytes',
  async () => {
    const reservation = await cacheProbeReservationTokens('gpt-5.6')
    strictEqual(Number.isSafeInteger(reservation), true)
    strictEqual(reservation > 3_202, true)
    strictEqual(reservation <= 1_000_000, true)
  },
)

function config(fetcher: typeof fetch): CacheProbeRuntimeConfig {
  return {
    baseUrl: 'https://relay.example.test/v1/',
    apiKey: 'server-only-cache-probe-key',
    model: 'gpt-5.6',
    timeoutMs: 5_000,
    fetcher,
  }
}

Deno.test('cache probe parses Responses cached-token usage without requiring cache writes', () => {
  deepStrictEqual(
    parseCacheProbeUsage({
      usage: {
        input_tokens: 1_600,
        output_tokens: 1,
        total_tokens: 1_601,
        input_tokens_details: { cached_tokens: 1_536 },
      },
    }),
    {
      inputTokens: 1_600,
      outputTokens: 1,
      totalTokens: 1_601,
      cachedInputTokens: 1_536,
      cacheWriteTokens: null,
    },
  )
  strictEqual(
    parseCacheProbeUsage({
      usage: {
        input_tokens: 10,
        output_tokens: 1,
        total_tokens: 12,
        input_tokens_details: { cached_tokens: 0 },
      },
    }),
    null,
  )
})

Deno.test(
  'cache probe sends an incremental typed conversation with one reusable explicit prefix',
  async () => {
    const requests: Array<{ url: string; body: string; headers: Headers }> = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        body: String(init?.body),
        headers: new Headers(init?.headers),
      })
      return requests.length === 1 ? jsonResponse(0, 1_536) : jsonResponse(1_536, 0)
    }

    const result = await runCacheProbe(config(fetcher))

    strictEqual(requests.length, 2)
    strictEqual(requests[0]?.url, 'https://relay.example.test/v1/responses')
    strictEqual(requests[0]?.body === requests[1]?.body, false)
    strictEqual(requests[0]?.headers.get('authorization'), 'Bearer server-only-cache-probe-key')
    const firstBody = JSON.parse(requests[0]?.body ?? '{}') as Record<string, unknown>
    const secondBody = JSON.parse(requests[1]?.body ?? '{}') as Record<string, unknown>
    match(String(firstBody.prompt_cache_key), /^[a-f0-9]{64}$/)
    strictEqual(firstBody.prompt_cache_key, secondBody.prompt_cache_key)
    strictEqual(firstBody.stream, false)
    strictEqual(firstBody.store, false)
    deepStrictEqual(firstBody.prompt_cache_options, { mode: 'explicit' })
    const firstInput = firstBody.input as Array<Record<string, unknown>>
    const secondInput = secondBody.input as Array<Record<string, unknown>>
    deepStrictEqual(secondInput[0], firstInput[0])
    strictEqual(firstInput.length, 1)
    strictEqual(secondInput.length, 3)
    match(JSON.stringify(firstInput), /cache probe validation.*Reply only with OK\./s)
    match(JSON.stringify(firstInput), /prompt_cache_breakpoint/)
    strictEqual(result.reusedInputTokens, 1_536)
    deepStrictEqual(result.aggregateUsage, {
      inputTokens: 3_200,
      outputTokens: 2,
      totalTokens: 3_202,
      cachedInputTokens: 1_536,
      cacheWriteTokens: 1_536,
    })
    const report = JSON.stringify(result)
    strictEqual(report.includes('server-only-cache-probe-key'), false)
    strictEqual(report.includes('relay.example.test'), false)
    strictEqual(report.includes('Reply only with OK'), false)
  },
)

Deno.test('cache probe exposes known usage when the second eligible request misses', async () => {
  await rejects(
    () => runCacheProbe(config(async () => jsonResponse(0, 1_536))),
    (error: unknown) => {
      strictEqual(error instanceof CacheProbeError, true)
      const probeError = error as CacheProbeError
      strictEqual(probeError.code, 'cache_probe_miss')
      strictEqual(probeError.knownResult?.aggregateUsage.totalTokens, 3_202)
      strictEqual(probeError.knownResult?.reusedInputTokens, 0)
      return true
    },
  )
})

Deno.test('cache probe fails closed when cached-token usage is absent', async () => {
  await rejects(
    () =>
      runCacheProbe(
        config(
          async () =>
            new Response(
              JSON.stringify({
                usage: { input_tokens: 1_600, output_tokens: 1, total_tokens: 1_601 },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        ),
      ),
    (error: unknown) => error instanceof CacheProbeError && error.code === 'cache_usage_missing',
  )
})
