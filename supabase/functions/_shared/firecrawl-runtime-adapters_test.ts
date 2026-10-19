import type { SupabaseClient } from '@supabase/supabase-js'
import { deepStrictEqual, equal } from 'node:assert/strict'
import type { NowcoderMetricsProvider } from './adapters/nowcoder.ts'
import type { QojMetricsProvider, QojSessionCleanupReporter } from './adapters/qoj.ts'
import {
  createRuntimeLuoguAdapter,
  createRuntimeNowcoderAdapter,
  createRuntimeQojAdapter,
  type FirecrawlRuntimeAdapterDependencies,
} from './firecrawl-runtime-adapters.ts'
import { HttpError } from './http.ts'

const client = {} as SupabaseClient
const runtimeKey = {
  keyId: '00000000-0000-4000-8000-000000000301',
  apiKey: 'fc-runtime-secret',
  apiUrl: 'https://api.firecrawl.dev',
  source: 'database' as const,
}

function sharedDependencies(
  select: (purpose: 'qoj' | 'nowcoder' | 'luogu', operationId: string | null) => void,
): FirecrawlRuntimeAdapterDependencies {
  return {
    qojServiceUsername: 'service_user',
    qojServicePassword: 'service-pass-value',
    selectKey(_client, purpose, operationId) {
      select(purpose, operationId ?? null)
      return Promise.resolve(runtimeKey)
    },
    observeOperation(_client, _key, _purpose, operation) {
      return operation()
    },
  }
}

Deno.test('runtime QOJ adapter selects one Key for the complete operation', async () => {
  const selections: Array<{ purpose: string; operationId: string | null }> = []
  const provider: QojMetricsProvider = {
    fetchAcceptedCount() {
      return Promise.resolve(37)
    },
  }
  const result = await createRuntimeQojAdapter(client, {
    ...sharedDependencies((purpose, operationId) => selections.push({ purpose, operationId })),
    operationId: 'qoj:42:1:00000000-0000-4000-8000-000000000301',
    qojProviderFactory() {
      return provider
    },
  }).sync('sample_user')

  equal(result.ok, true)
  deepStrictEqual(selections, [
    {
      purpose: 'qoj',
      operationId: 'qoj:42:1:00000000-0000-4000-8000-000000000301',
    },
  ])
})

Deno.test(
  'runtime Luogu rotates seven Keys over fourteen requests and observes each Key',
  async () => {
    const selections: string[] = []
    const observations: string[] = []
    const apiKeys: string[] = []
    const pages: number[] = []
    const keys = Array.from({ length: 7 }, (_, index) => ({
      ...runtimeKey,
      keyId: `00000000-0000-4000-8000-00000000030${index + 1}`,
      apiKey: `synthetic-key-${index + 1}`,
    }))
    const result = await createRuntimeLuoguAdapter(client, {
      selectKey(_client, purpose, operationId) {
        const key = keys[selections.length % keys.length]
        selections.push(`${purpose}:${operationId}`)
        return Promise.resolve(key)
      },
      operationId: 'luogu:42:1:301',
      luoguCookie: 'synthetic-cookie',
      luoguCsrfToken: 'synthetic-csrf',
      luoguTransportFactory(apiKey, cookie, csrf) {
        apiKeys.push(apiKey)
        equal(cookie, 'synthetic-cookie')
        equal(csrf, 'synthetic-csrf')
        return {
          fetchRecordPage(_accountId, page) {
            pages.push(page)
            return Promise.resolve({
              template: 'record.list',
              data: {
                records: {
                  count: 14,
                  result: [
                    {
                      id: 103 - page,
                      submitTime: 103 - page,
                      status: 12,
                      problem: { pid: `P${1000 + page}` },
                    },
                  ],
                },
              },
            })
          },
        }
      },
      observeOperation(_client, key, purpose, operation) {
        equal(purpose, 'luogu')
        observations.push(key.keyId!)
        return operation()
      },
    }).sync('409073')
    equal(result.ok, true)
    if (!result.ok) return
    equal(result.metrics.solvedCount, 14)
    deepStrictEqual(
      selections,
      Array.from({ length: 14 }, (_, index) => `luogu:luogu:42:1:301:request:${index + 1}`),
    )
    deepStrictEqual(
      pages,
      Array.from({ length: 14 }, (_, index) => index + 1),
    )
    deepStrictEqual(
      apiKeys,
      [...keys, ...keys].map((key) => key.apiKey),
    )
    deepStrictEqual(
      observations,
      [...keys, ...keys].map((key) => key.keyId),
    )
  },
)

Deno.test('runtime Luogu stops on a failed page without selecting another Key', async () => {
  let selections = 0
  let requests = 0
  const result = await createRuntimeLuoguAdapter(client, {
    ...sharedDependencies(() => selections++),
    operationId: 'luogu:43:1:301',
    luoguCookie: 'cookie',
    luoguCsrfToken: 'csrf',
    luoguTransportFactory() {
      return {
        fetchRecordPage() {
          requests++
          throw new HttpError('limited', 'rate_limited', true, 429)
        },
      }
    },
  }).sync('409073')
  equal(result.ok, false)
  equal(selections, 1)
  equal(requests, 1)
  equal('syncState' in result, false)
})

Deno.test(
  'runtime Luogu stops after a later-page 429 without a third Key or partial state',
  async () => {
    const claims: Array<string | null> = []
    let requests = 0
    const result = await createRuntimeLuoguAdapter(client, {
      ...sharedDependencies((_purpose, operationId) => claims.push(operationId)),
      operationId: 'luogu:44:1:301',
      luoguCookie: 'cookie',
      luoguCsrfToken: 'csrf',
      luoguTransportFactory() {
        return {
          fetchRecordPage() {
            requests++
            if (requests === 2) throw new HttpError('limited', 'rate_limited', true, 429)
            return Promise.resolve({
              template: 'record.list',
              data: {
                records: {
                  count: 2,
                  result: [{ id: 102, submitTime: 102, status: 12, problem: { pid: 'P1000' } }],
                },
              },
            })
          },
        }
      },
    }).sync('409073')
    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'rate_limited')
    equal(result.error.retryable, true)
    deepStrictEqual(claims, ['luogu:44:1:301:request:1', 'luogu:44:1:301:request:2'])
    equal(requests, 2)
    equal('syncState' in result, false)
  },
)

Deno.test('runtime Luogu gives a rebuilt page a new request claim', async () => {
  const claims: Array<string | null> = []
  const pages: number[] = []
  const result = await createRuntimeLuoguAdapter(client, {
    ...sharedDependencies((_purpose, operationId) => claims.push(operationId)),
    operationId: 'luogu:45:1:301',
    luoguCookie: 'cookie',
    luoguCsrfToken: 'csrf',
    luoguTransportFactory() {
      return {
        fetchRecordPage(_accountId, page) {
          pages.push(page)
          return Promise.resolve({
            template: 'record.list',
            data: {
              records: {
                count: 1,
                result: [{ id: 102, submitTime: 102, status: 12, problem: { pid: 'B2000' } }],
              },
            },
          })
        },
      }
    },
  }).sync('409073', {
    syncState: {
      accountId: '409073',
      boundaryRecordId: '102',
      boundarySubmitTime: 101,
      totalRecords: 1,
      problemIds: ['P1000'],
      lastFullSyncAt: new Date().toISOString(),
    },
  })
  equal(result.ok, true)
  if (!result.ok) return
  equal(result.details?.syncMode, 'rebuild')
  equal(result.metrics.solvedCount, 1)
  deepStrictEqual(pages, [1, 1])
  deepStrictEqual(claims, ['luogu:45:1:301:request:1', 'luogu:45:1:301:request:2'])
})

Deno.test(
  'runtime Luogu rejects missing credentials and invalid UID before Key selection',
  async () => {
    for (const accountId of ['409073', 'invalid-uid']) {
      let selections = 0
      const result = await createRuntimeLuoguAdapter(client, {
        ...sharedDependencies(() => selections++),
        luoguCookie: null,
        luoguCsrfToken: null,
      }).sync(accountId)
      equal(result.ok, false)
      equal(selections, 0)
    }
  },
)

Deno.test('runtime Luogu configured pool exhaustion does not use the environment Key', async () => {
  let factories = 0
  const result = await createRuntimeLuoguAdapter(client, {
    ...sharedDependencies(() => {}),
    luoguCookie: 'cookie',
    luoguCsrfToken: 'csrf',
    selectKey: () => Promise.resolve(null),
    luoguTransportFactory() {
      factories++
      throw new Error('must not run')
    },
  }).sync('409073')
  equal(result.ok, false)
  equal(factories, 0)
})

Deno.test('runtime QOJ adapter never selects a replacement Key after failure', async () => {
  const selections: Array<{ purpose: string; operationId: string | null }> = []
  const provider: QojMetricsProvider = {
    fetchAcceptedCount() {
      return Promise.reject(new HttpError('limited', 'rate_limited', true, 429))
    },
  }
  const result = await createRuntimeQojAdapter(client, {
    ...sharedDependencies((purpose, operationId) => selections.push({ purpose, operationId })),
    operationId: 'qoj:43:1:00000000-0000-4000-8000-000000000301',
    qojProviderFactory() {
      return provider
    },
  }).sync('sample_user')

  equal(result.ok, false)
  deepStrictEqual(selections, [
    {
      purpose: 'qoj',
      operationId: 'qoj:43:1:00000000-0000-4000-8000-000000000301',
    },
  ])
  if (result.ok) throw new Error('Expected QOJ synchronization failure')
  equal(result.error.code, 'rate_limited')
})

Deno.test('runtime QOJ cleanup logs use the internal sync run id', async () => {
  let cleanupReporter: QojSessionCleanupReporter | undefined
  const provider: QojMetricsProvider = {
    fetchAcceptedCount() {
      return Promise.resolve(37)
    },
  }
  const result = await createRuntimeQojAdapter(client, {
    ...sharedDependencies(() => {}),
    syncRunId: 601,
    qojProviderFactory(_apiKey, _username, _password, _apiUrl, _fetcher, reporter) {
      cleanupReporter = reporter
      return provider
    },
  }).sync('sample_user')

  equal(result.ok, true)
  if (!cleanupReporter) throw new Error('Expected a QOJ cleanup reporter')
  const originalInfo = console.info
  const infoLogs: string[] = []
  console.info = (...values: unknown[]) => infoLogs.push(values.map(String).join(' '))
  try {
    cleanupReporter('succeeded')
  } finally {
    console.info = originalInfo
  }
  deepStrictEqual(infoLogs, [
    JSON.stringify({ event: 'qoj_firecrawl_session_cleanup_succeeded', syncRunId: 601 }),
  ])
})

Deno.test('missing QOJ service credentials fail before a Key is selected', async () => {
  let selections = 0
  const result = await createRuntimeQojAdapter(client, {
    ...sharedDependencies(() => {
      selections += 1
    }),
    qojServiceUsername: null,
    qojServicePassword: null,
  }).sync('sample_user')

  equal(result.ok, false)
  equal(selections, 0)
  if (result.ok) throw new Error('Expected QOJ configuration failure')
  equal(result.error.code, 'auth_required')
})

Deno.test('runtime Nowcoder adapter selects no Key on direct success', async () => {
  let selections = 0
  const primary: NowcoderMetricsProvider = {
    fetchMetrics() {
      return Promise.resolve({
        currentRating: 1490,
        maxRating: 1600,
        solvedCount: 263,
        ratedContestCount: 3,
        lastRatedAt: null,
        sourceVersion: 'nowcoder-direct-test',
        provider: 'direct',
      })
    },
  }
  const result = await createRuntimeNowcoderAdapter(client, {
    ...sharedDependencies(() => {
      selections += 1
    }),
    nowcoderPrimary: primary,
  }).sync('123456789')

  equal(result.ok, true)
  equal(selections, 0)
})

Deno.test('runtime Nowcoder WAF fallback lazily selects exactly one Key', async () => {
  const selections: Array<{ purpose: string; operationId: string | null }> = []
  const primary: NowcoderMetricsProvider = {
    fetchMetrics() {
      return Promise.reject(new HttpError('WAF', 'source_unavailable', true))
    },
  }
  const fallback: NowcoderMetricsProvider = {
    fetchMetrics() {
      return Promise.resolve({
        currentRating: 1490,
        maxRating: 1600,
        solvedCount: 263,
        ratedContestCount: 3,
        lastRatedAt: null,
        sourceVersion: 'nowcoder-firecrawl-test',
        provider: 'firecrawl',
      })
    },
  }
  const result = await createRuntimeNowcoderAdapter(client, {
    ...sharedDependencies((purpose, operationId) => selections.push({ purpose, operationId })),
    nowcoderPrimary: primary,
    nowcoderProviderFactory() {
      return fallback
    },
  }).sync('123456789')

  equal(result.ok, true)
  deepStrictEqual(selections, [{ purpose: 'nowcoder', operationId: null }])
})
