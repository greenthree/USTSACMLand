import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProductionCacheProbeError,
  runProductionCacheProbe,
} from './check-webchat-production-cache-probe.mjs'

const projectRef = 'qzggoqdmsvktrtnjislw'
const serviceRoleKey = 'service-role-production-test-key'

function probe(cachedTokens = 1_536) {
  return {
    model: 'gpt-5.6',
    transport: 'streaming',
    cachePolicy: 'declared_implicit',
    promptCacheKeyPrefix: '0000000000000000',
    sharedPrefixFingerprint: 'a'.repeat(64),
    diagnosis: cachedTokens > 0 ? 'cache_hit' : 'cache_write_without_read',
    first: {
      durationMs: 120,
      clientRequestId: 'webchat-cache-probe:test-run:1',
      requestFingerprint: 'b'.repeat(64),
      response: {
        responseId: 'response-1',
        observedModel: 'gpt-5.6',
        serviceTier: 'default',
        systemFingerprint: 'system-1',
        upstreamRequestId: 'upstream-1',
      },
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
      clientRequestId: 'webchat-cache-probe:test-run:2',
      requestFingerprint: 'c'.repeat(64),
      response: {
        responseId: 'response-2',
        observedModel: 'gpt-5.6',
        serviceTier: 'default',
        systemFingerprint: 'system-2',
        upstreamRequestId: 'upstream-2',
      },
      usage: {
        inputTokens: 1_600,
        outputTokens: 1,
        totalTokens: 1_601,
        cachedInputTokens: cachedTokens,
        cacheWriteTokens: 0,
      },
    },
    aggregateUsage: {
      inputTokens: 3_200,
      outputTokens: 2,
      totalTokens: 3_202,
      cachedInputTokens: cachedTokens,
      cacheWriteTokens: 1_536,
    },
    reusedInputTokens: cachedTokens,
  }
}

function successPayload() {
  return {
    ok: true,
    checkedAt: '2026-07-18T14:00:00.000Z',
    usageDate: '2026-07-18',
    remainingGlobalRequests: 98,
    remainingGlobalTokens: 990_000,
    chargedTokens: 3_202,
    probe: probe(),
    ignoredSecretLikeField: serviceRoleKey,
  }
}

describe('production WebChat cache probe', () => {
  it('calls only the service-role Supabase function and writes a whitelisted report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'usts-cache-probe-'))
    const reportPath = join(directory, 'report.json')
    let requestedUrl = ''
    let requestedHeaders = new Headers()
    try {
      const report = await runProductionCacheProbe({
        projectRef,
        serviceRoleKey,
        reportPath,
        fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
          requestedUrl = String(input)
          requestedHeaders = new Headers(init?.headers)
          expect(init?.method).toBe('POST')
          expect(JSON.parse(String(init?.body))).toEqual({
            transport: 'streaming',
            cachePolicy: 'declared_implicit',
          })
          return new Response(JSON.stringify(successPayload()), {
            headers: { 'content-type': 'application/json' },
          })
        },
      })

      expect(requestedUrl).toBe(
        `https://${projectRef}.supabase.co/functions/v1/webchat-cache-probe`,
      )
      expect(requestedHeaders.get('authorization')).toBe(`Bearer ${serviceRoleKey}`)
      expect(requestedHeaders.get('apikey')).toBe(serviceRoleKey)
      expect(requestedHeaders.get('content-type')).toBe('application/json')
      expect(report.probe.reusedInputTokens).toBe(1_536)
      expect(report.probe.transport).toBe('streaming')
      expect(report.probe.cachePolicy).toBe('declared_implicit')
      expect(report.probe.diagnosis).toBe('cache_hit')
      expect(report.probe.first.clientRequestId).toBe('webchat-cache-probe:test-run:1')
      expect(report.probe.second.response.upstreamRequestId).toBe('upstream-2')
      const artifact = await readFile(reportPath, 'utf8')
      expect(artifact).not.toContain(serviceRoleKey)
      expect(artifact).not.toContain(projectRef)
      expect(artifact).not.toContain('ignoredSecretLikeField')
      expect(JSON.parse(artifact)).toEqual(report)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails when the function returns a known zero-cache observation', async () => {
    await expect(
      runProductionCacheProbe({
        projectRef,
        serviceRoleKey,
        fetcher: async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'cache_probe_miss',
                message: 'The repeated eligible request returned zero cached input tokens',
                retryAfterSeconds: null,
              },
              probe: probe(0),
            }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          ),
      }),
    ).rejects.toMatchObject<Partial<ProductionCacheProbeError>>({
      code: 'cache_probe_miss',
      status: 502,
    })
  })

  it('rejects missing Supabase credentials before any network call', async () => {
    let calls = 0
    await expect(
      runProductionCacheProbe({
        projectRef,
        serviceRoleKey: '',
        fetcher: async () => {
          calls += 1
          return new Response('{}')
        },
      }),
    ).rejects.toMatchObject({ code: 'missing_configuration' })
    expect(calls).toBe(0)
  })

  it('rejects unsupported manual comparison options before any network call', async () => {
    let calls = 0
    await expect(
      runProductionCacheProbe({
        projectRef,
        serviceRoleKey,
        transport: 'automatic',
        fetcher: async () => {
          calls += 1
          return new Response('{}')
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_configuration' })
    expect(calls).toBe(0)
  })
})
