// deno-lint-ignore-file require-await
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  createCacheProbeHandler,
  type CacheProbeClaimResult,
  type CacheProbeServices,
} from './handler.ts'
import { CacheProbeError, type CacheProbeResult } from './probe.ts'

const serviceRoleKey = 'service-role-test-key'

function testToken(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${encoded}.signature`
}
const runtimeConfig = {
  baseUrl: 'https://relay.example.test/v1',
  apiKey: 'relay-secret-key',
  model: 'gpt-5.6',
  requestsEnabled: true,
  globalDailyRequestLimit: 100,
  globalDailyTokenLimit: 1_000_000,
}
const claim: CacheProbeClaimResult = {
  decision: 'acquired',
  status: 'claimed',
  retryAfterSeconds: null,
  usageDate: '2026-07-18',
  remainingGlobalRequests: 98,
  remainingGlobalTokens: 990_000,
}
const result: CacheProbeResult = {
  model: 'gpt-5.6',
  transport: 'streaming',
  first: {
    durationMs: 120,
    usage: {
      inputTokens: 1_600,
      outputTokens: 1,
      totalTokens: 1_601,
      cachedInputTokens: 0,
      cacheWriteTokens: 1_536,
    },
  },
  second: {
    durationMs: 80,
    usage: {
      inputTokens: 1_600,
      outputTokens: 1,
      totalTokens: 1_601,
      cachedInputTokens: 1_536,
      cacheWriteTokens: 0,
    },
  },
  aggregateUsage: {
    inputTokens: 3_200,
    outputTokens: 2,
    totalTokens: 3_202,
    cachedInputTokens: 1_536,
    cacheWriteTokens: 1_536,
  },
  reusedInputTokens: 1_536,
}

function services(overrides: Partial<CacheProbeServices> = {}): CacheProbeServices {
  return {
    async claim() {
      return claim
    },
    async readRuntimeConfig() {
      return runtimeConfig
    },
    async markStarted() {
      return true
    },
    async finalize() {
      return { transitioned: true, status: 'finished', chargedTokens: 3_202 }
    },
    async release() {
      return true
    },
    async run() {
      return result
    },
    ...overrides,
  }
}

function handler(currentServices: CacheProbeServices) {
  return createCacheProbeHandler({
    serviceRoleKey,
    leaseSeconds: 300,
    timeoutMs: 120_000,
    async reservationTokens() {
      return 40_000
    },
    createServices: () => currentServices,
  })
}

function request(headers: HeadersInit = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/webchat-cache-probe', {
    method: 'POST',
    headers: { authorization: `Bearer ${serviceRoleKey}`, ...headers },
  })
}

Deno.test(
  'cache probe endpoint accepts POST only and requires gateway-verified service-role authorization',
  async () => {
    const currentHandler = handler(services())
    const methodResponse = await currentHandler(
      new Request('https://project.supabase.co/functions/v1/webchat-cache-probe', {
        method: 'GET',
      }),
    )
    strictEqual(methodResponse.status, 405)
    strictEqual(methodResponse.headers.get('allow'), 'POST')

    const unauthorized = await currentHandler(
      new Request('https://project.supabase.co/functions/v1/webchat-cache-probe', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-key' },
      }),
    )
    strictEqual(unauthorized.status, 401)
    strictEqual((await unauthorized.json()).error.code, 'unauthorized')

    const rotatedServiceRole = await currentHandler(
      request({ authorization: `Bearer ${testToken({ role: 'service_role' })}` }),
    )
    strictEqual(rotatedServiceRole.status, 200)

    const authenticatedUser = await currentHandler(
      request({ authorization: `Bearer ${testToken({ role: 'authenticated' })}` }),
    )
    strictEqual(authenticatedUser.status, 401)
  },
)

Deno.test(
  'cache probe endpoint rejects browser-origin requests even with service credentials',
  async () => {
    const response = await handler(services())(request({ origin: 'https://greenthree.github.io' }))
    strictEqual(response.status, 403)
    strictEqual((await response.json()).error.code, 'browser_origin_rejected')
  },
)

Deno.test(
  'cache probe endpoint surfaces cooldown without starting an upstream request',
  async () => {
    let runtimeReads = 0
    let runs = 0
    const response = await handler(
      services({
        async claim() {
          return { ...claim, decision: 'cooldown', retryAfterSeconds: 900 }
        },
        async readRuntimeConfig() {
          runtimeReads += 1
          return runtimeConfig
        },
        async run() {
          runs += 1
          return result
        },
      }),
    )(request())

    strictEqual(response.status, 429)
    strictEqual(response.headers.get('retry-after'), '900')
    strictEqual(runtimeReads, 1)
    strictEqual(runs, 0)
  },
)

Deno.test(
  'cache probe creates no reservation if runtime configuration cannot be read',
  async () => {
    const released: string[] = []
    const response = await handler(
      services({
        async readRuntimeConfig() {
          throw new Error('vault unavailable')
        },
        async release(_probeId, _ownerToken, reason) {
          released.push(reason)
          return true
        },
      }),
    )(request())

    strictEqual(response.status, 503)
    deepStrictEqual(released, [])
  },
)

Deno.test(
  'cache probe releases the reservation if its lease expires before upstream I/O',
  async () => {
    const events: string[] = []
    const response = await handler(
      services({
        async markStarted() {
          events.push('mark')
          return false
        },
        async release(_probeId, _ownerToken, reason) {
          events.push(`release:${reason}`)
          return true
        },
        async run() {
          events.push('run')
          return result
        },
      }),
    )(request())

    strictEqual(response.status, 409)
    deepStrictEqual(events, ['mark', 'release:claim_expired'])
  },
)

Deno.test('cache probe executes and settles in claim-read-start-run-finalize order', async () => {
  const events: string[] = []
  const response = await handler(
    services({
      async claim(input) {
        events.push(`claim:${input.reservedTokens}:${input.leaseSeconds}`)
        return claim
      },
      async readRuntimeConfig() {
        events.push('read')
        return runtimeConfig
      },
      async markStarted() {
        events.push('mark')
        return true
      },
      async run(config) {
        events.push(`run:${config.model}`)
        strictEqual(config.apiKey, 'relay-secret-key')
        strictEqual(config.stream, true)
        return result
      },
      async finalize(_probeId, _ownerToken, outcome, knownResult) {
        events.push(`finalize:${outcome}`)
        strictEqual(knownResult, result)
        return { transitioned: true, status: 'finished', chargedTokens: 3_202 }
      },
    }),
  )(request())

  strictEqual(response.status, 200)
  deepStrictEqual(events, ['read', 'claim:40000:300', 'mark', 'run:gpt-5.6', 'finalize:cache_hit'])
  const payload = await response.json()
  strictEqual(payload.ok, true)
  strictEqual(payload.probe.reusedInputTokens, 1_536)
  const serialized = JSON.stringify(payload)
  strictEqual(serialized.includes('relay-secret-key'), false)
  strictEqual(serialized.includes('relay.example.test'), false)
})

Deno.test('usage above the conservative reservation is settled as unknown and fails', async () => {
  const finalized: Array<{ outcome: string; known: CacheProbeResult | null }> = []
  const response = await handler(
    services({
      async run() {
        return {
          ...result,
          aggregateUsage: { ...result.aggregateUsage, totalTokens: 40_001 },
        }
      },
      async finalize(_probeId, _ownerToken, outcome, knownResult) {
        finalized.push({ outcome, known: knownResult })
        return { transitioned: true, status: 'finished', chargedTokens: 40_000 }
      },
    }),
  )(request())

  strictEqual(response.status, 502)
  strictEqual((await response.json()).error.code, 'usage_exceeds_reservation')
  deepStrictEqual(finalized, [{ outcome: 'usage_exceeds_reservation', known: null }])
})

Deno.test('cache miss settles known usage and returns sanitized evidence', async () => {
  const finalized: Array<{ outcome: string; known: CacheProbeResult | null }> = []
  const response = await handler(
    services({
      async run() {
        throw new CacheProbeError('cache_probe_miss', 'No cached tokens', 502, {
          ...result,
          reusedInputTokens: 0,
          second: {
            ...result.second,
            usage: { ...result.second.usage, cachedInputTokens: 0 },
          },
          aggregateUsage: { ...result.aggregateUsage, cachedInputTokens: 0 },
        })
      },
      async finalize(_probeId, _ownerToken, outcome, knownResult) {
        finalized.push({ outcome, known: knownResult })
        return { transitioned: true, status: 'finished', chargedTokens: 3_202 }
      },
    }),
  )(request())

  strictEqual(response.status, 502)
  strictEqual((await response.json()).error.code, 'cache_probe_miss')
  strictEqual(finalized[0]?.outcome, 'cache_probe_miss')
  strictEqual(finalized[0]?.known?.reusedInputTokens, 0)
})

Deno.test('unknown upstream failures settle conservatively without fabricated usage', async () => {
  const finalized: Array<CacheProbeResult | null> = []
  const response = await handler(
    services({
      async run() {
        throw new Error('unexpected network failure')
      },
      async finalize(_probeId, _ownerToken, outcome, knownResult) {
        strictEqual(outcome, 'unexpected_probe_error')
        finalized.push(knownResult)
        return { transitioned: true, status: 'finished', chargedTokens: 40_000 }
      },
    }),
  )(request())

  strictEqual(response.status, 502)
  strictEqual((await response.json()).error.code, 'unexpected_probe_error')
  deepStrictEqual(finalized, [null])
})
