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
          expect(init?.body).toBeUndefined()
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
      expect(report.probe.reusedInputTokens).toBe(1_536)
      expect(report.probe.transport).toBe('streaming')
      expect(report.probe.cachePolicy).toBe('declared_implicit')
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
})
