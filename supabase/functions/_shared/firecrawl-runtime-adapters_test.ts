import type { SupabaseClient } from '@supabase/supabase-js'
import { deepStrictEqual, equal } from 'node:assert/strict'
import type { NowcoderMetricsProvider } from './adapters/nowcoder.ts'
import type { QojMetricsProvider } from './adapters/qoj.ts'
import {
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
  select: (purpose: 'qoj' | 'nowcoder', operationId: string | null) => void,
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
