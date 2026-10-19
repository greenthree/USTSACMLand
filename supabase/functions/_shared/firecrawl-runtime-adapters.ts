import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFirecrawlLuoguTransport,
  createLuoguAdapter,
  type LuoguTransport,
} from './adapters/luogu.ts'
import {
  createFirecrawlNowcoderProvider,
  createNowcoderAdapter,
  type NowcoderMetricsProvider,
} from './adapters/nowcoder.ts'
import {
  createFirecrawlQojProvider,
  createQojAdapter,
  logQojSessionCleanup,
  type QojSessionCleanupStatus,
  type QojMetricsProvider,
} from './adapters/qoj.ts'
import type { PlatformAdapter } from './adapters/types.ts'
import { observeFirecrawlOperation, selectFirecrawlRuntimeKey } from './firecrawl-key-pool.ts'
import { HttpError } from './http.ts'

export interface FirecrawlRuntimeAdapterDependencies {
  selectKey?: typeof selectFirecrawlRuntimeKey
  observeOperation?: typeof observeFirecrawlOperation
  operationId?: string
  syncRunId?: number
  qojServiceUsername?: string | null
  qojServicePassword?: string | null
  qojProviderFactory?: typeof createFirecrawlQojProvider
  nowcoderPrimary?: NowcoderMetricsProvider
  nowcoderProviderFactory?: typeof createFirecrawlNowcoderProvider
  luoguCookie?: string | null
  luoguCsrfToken?: string | null
  luoguTransportFactory?: typeof createFirecrawlLuoguTransport
}

function missingRuntimeKey(purpose: 'qoj' | 'nowcoder' | 'luogu'): HttpError {
  return new HttpError(
    'No enabled Firecrawl API key is currently available',
    'source_unavailable',
    purpose === 'nowcoder',
  )
}

function qojRuntimeProvider(
  client: SupabaseClient,
  dependencies: FirecrawlRuntimeAdapterDependencies,
): QojMetricsProvider {
  return {
    async fetchAcceptedCount(accountId, signal) {
      const serviceUsername =
        dependencies.qojServiceUsername === undefined
          ? Deno.env.get('QOJ_SERVICE_USERNAME')?.trim()
          : dependencies.qojServiceUsername?.trim()
      const servicePassword =
        dependencies.qojServicePassword === undefined
          ? Deno.env.get('QOJ_SERVICE_PASSWORD')
          : dependencies.qojServicePassword
      if (!serviceUsername || !servicePassword) {
        throw new HttpError('QOJ service-account login is not configured', 'auth_required', false)
      }

      const key = await (dependencies.selectKey ?? selectFirecrawlRuntimeKey)(
        client,
        'qoj',
        dependencies.operationId ?? null,
      )
      if (!key) throw missingRuntimeKey('qoj')

      const provider = (dependencies.qojProviderFactory ?? createFirecrawlQojProvider)(
        key.apiKey,
        serviceUsername,
        servicePassword,
        key.apiUrl,
        undefined,
        (status: QojSessionCleanupStatus) => logQojSessionCleanup(status, dependencies.syncRunId),
      )
      return await (dependencies.observeOperation ?? observeFirecrawlOperation)(
        client,
        key,
        'qoj',
        () => provider.fetchAcceptedCount(accountId, signal),
      )
    },
  }
}

function nowcoderRuntimeProvider(
  client: SupabaseClient,
  dependencies: FirecrawlRuntimeAdapterDependencies,
): NowcoderMetricsProvider {
  return {
    async fetchMetrics(accountId, signal) {
      // createNowcoderAdapter calls this provider only after a direct request
      // has failed with one of the allowlisted WAF/availability codes. Key
      // selection therefore remains lazy and happens exactly once per fallback.
      const key = await (dependencies.selectKey ?? selectFirecrawlRuntimeKey)(client, 'nowcoder')
      if (!key) throw missingRuntimeKey('nowcoder')
      const provider = (dependencies.nowcoderProviderFactory ?? createFirecrawlNowcoderProvider)(
        key.apiKey,
        key.apiUrl,
      )
      return await (dependencies.observeOperation ?? observeFirecrawlOperation)(
        client,
        key,
        'nowcoder',
        () => provider.fetchMetrics(accountId, signal),
      )
    },
  }
}

export function createRuntimeQojAdapter(
  client: SupabaseClient,
  dependencies: FirecrawlRuntimeAdapterDependencies = {},
): PlatformAdapter {
  return createQojAdapter({ provider: qojRuntimeProvider(client, dependencies) })
}

export function createRuntimeNowcoderAdapter(
  client: SupabaseClient,
  dependencies: FirecrawlRuntimeAdapterDependencies = {},
): PlatformAdapter {
  return createNowcoderAdapter({
    ...(dependencies.nowcoderPrimary ? { primary: dependencies.nowcoderPrimary } : {}),
    fallback: nowcoderRuntimeProvider(client, dependencies),
  })
}

export function createRuntimeLuoguAdapter(
  client: SupabaseClient,
  dependencies: FirecrawlRuntimeAdapterDependencies = {},
): PlatformAdapter {
  // One lazy selection for every page (including rebuilds) in this attempt.
  // A rejected selection stays rejected; it must not claim a replacement Key.
  let selectedTransport: Promise<LuoguTransport> | undefined
  async function selectTransport(): Promise<LuoguTransport> {
    const cookie =
      dependencies.luoguCookie === undefined
        ? Deno.env.get('LUOGU_COOKIE')?.trim()
        : dependencies.luoguCookie?.trim()
    const csrf =
      dependencies.luoguCsrfToken === undefined
        ? Deno.env.get('LUOGU_CSRF_TOKEN')?.trim()
        : dependencies.luoguCsrfToken?.trim()
    if (!cookie || !csrf) {
      throw new HttpError('Luogu authentication is not configured', 'not_configured', false)
    }
    const key = await (dependencies.selectKey ?? selectFirecrawlRuntimeKey)(
      client,
      'luogu',
      dependencies.operationId ?? null,
    )
    if (!key) throw missingRuntimeKey('luogu')
    const transport = (dependencies.luoguTransportFactory ?? createFirecrawlLuoguTransport)(
      key.apiKey,
      cookie,
      csrf,
      key.apiUrl,
    )
    return {
      fetchRecordPage(accountId, page, signal) {
        return (dependencies.observeOperation ?? observeFirecrawlOperation)(
          client,
          key,
          'luogu',
          () => transport.fetchRecordPage(accountId, page, signal),
        )
      },
    }
  }
  return createLuoguAdapter({
    maxPages: Number(Deno.env.get('LUOGU_MAX_PAGES') ?? 100),
    pageDelayMs: 300,
    transport: {
      async fetchRecordPage(accountId, page, signal) {
        selectedTransport ??= selectTransport()
        return (await selectedTransport).fetchRecordPage(accountId, page, signal)
      },
    },
  })
}
