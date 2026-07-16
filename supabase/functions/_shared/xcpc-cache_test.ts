import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import { HttpError } from './http.ts'
import {
  createXcpcSharedCacheLoader,
  loadXcpcRemoteSource,
  prepareXcpcCachedPlayers,
  type XcpcCacheAcquireResult,
  type XcpcCacheOptions,
  type XcpcCacheSnapshot,
  type XcpcCacheStore,
  type XcpcModifiedSource,
  type XcpcNotModifiedSource,
} from './xcpc-cache.ts'
import { XCPC_TARGET_ORGANIZATION } from './adapters/xcpc-elo.ts'
import type { AdapterErrorCode } from './adapters/types.ts'

const NOW = Date.parse('2026-07-14T00:00:00.000Z')
const PLAYER = {
  id: 'xcpc_1111111111111111',
  teamMember: '张三',
  organization: XCPC_TARGET_ORGANIZATION,
  rating: 1680,
  maxRating: 1720,
  contests: 8,
}

function timestamp(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString()
}

function snapshot(overrides: Partial<XcpcCacheSnapshot> = {}): XcpcCacheSnapshot {
  return {
    activeVersion: 1,
    etag: '"old-etag"',
    lastModified: 'Tue, 14 Jul 2026 00:00:00 GMT',
    sourceGeneratedAt: timestamp(-60_000),
    validatedAt: timestamp(-60_000),
    expiresAt: timestamp(60_000),
    refreshLeaseExpiresAt: null,
    refreshRetryAfter: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    players: [PLAYER],
    ...overrides,
  }
}

const OPTIONS: XcpcCacheOptions = {
  ttlSeconds: 60,
  leaseSeconds: 30,
  retrySeconds: 30,
  waitMs: 100,
  pollMs: 1,
  now: () => NOW,
}

class MemoryStore implements XcpcCacheStore {
  reads = 0
  acquires = 0
  modifiedCommits = 0
  notModifiedCommits = 0
  failures: Array<{ code: AdapterErrorCode; message: string }> = []
  acquireResults: XcpcCacheAcquireResult[] = []

  constructor(public current: XcpcCacheSnapshot) {}

  read(): Promise<XcpcCacheSnapshot> {
    this.reads += 1
    return Promise.resolve(structuredClone(this.current))
  }

  acquire(): Promise<XcpcCacheAcquireResult> {
    this.acquires += 1
    const queued = this.acquireResults.shift()
    if (queued) return Promise.resolve(queued)
    return Promise.resolve({
      acquired: true,
      reason: 'acquired',
      activeVersion: this.current.activeVersion,
      etag: this.current.etag,
      lastModified: this.current.lastModified,
      expiresAt: this.current.expiresAt,
      refreshLeaseExpiresAt: timestamp(30_000),
      refreshRetryAfter: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    })
  }

  commitModified(_owner: string, ttlSeconds: number, source: XcpcModifiedSource): Promise<number> {
    this.modifiedCommits += 1
    const version = this.current.activeVersion + 1
    this.current = snapshot({
      activeVersion: version,
      etag: source.etag,
      lastModified: source.lastModified,
      sourceGeneratedAt: source.sourceGeneratedAt,
      validatedAt: timestamp(0),
      expiresAt: timestamp(ttlSeconds * 1_000),
      players: source.players.map((player) => ({
        id: player.player_id,
        teamMember: player.display_name,
        organization: player.organization,
        rating: player.rating,
        maxRating: player.max_rating ?? undefined,
        contests: player.contests ?? undefined,
      })),
    })
    return Promise.resolve(version)
  }

  commitNotModified(
    _owner: string,
    ttlSeconds: number,
    source: XcpcNotModifiedSource,
  ): Promise<number> {
    this.notModifiedCommits += 1
    this.current = {
      ...this.current,
      etag: source.etag ?? this.current.etag,
      lastModified: source.lastModified ?? this.current.lastModified,
      validatedAt: timestamp(0),
      expiresAt: timestamp(ttlSeconds * 1_000),
    }
    return Promise.resolve(this.current.activeVersion)
  }

  fail(
    _owner: string,
    code: AdapterErrorCode,
    message: string,
    _retrySeconds: number,
  ): Promise<void> {
    this.failures.push({ code, message })
    return Promise.resolve()
  }
}

Deno.test('XCPC shared cache returns a fresh snapshot without acquiring a lease', async () => {
  const store = new MemoryStore(snapshot())
  let sourceLoads = 0
  const loader = createXcpcSharedCacheLoader(
    store,
    () => {
      sourceLoads += 1
      throw new Error('source should not be loaded')
    },
    OPTIONS,
  )

  const dataset = await loader()
  strictEqual(dataset.cacheVersion, 1)
  strictEqual(store.acquires, 0)
  strictEqual(sourceLoads, 0)
})

Deno.test('XCPC shared cache publishes a versioned filtered refresh', async () => {
  const store = new MemoryStore(snapshot({ expiresAt: timestamp(-1) }))
  const source: XcpcModifiedSource = {
    kind: 'modified',
    etag: '"new-etag"',
    lastModified: 'Tue, 14 Jul 2026 01:00:00 GMT',
    sourceGeneratedAt: timestamp(0),
    players: [
      {
        player_id: PLAYER.id,
        normalized_name: PLAYER.teamMember,
        display_name: PLAYER.teamMember,
        organization: PLAYER.organization,
        rating: 1700,
        max_rating: 1750,
        contests: 9,
      },
    ],
  }
  let metadata: unknown
  const loader = createXcpcSharedCacheLoader(
    store,
    (value) => {
      metadata = value
      return Promise.resolve(source)
    },
    OPTIONS,
  )

  const dataset = await loader()
  deepStrictEqual(metadata, {
    etag: '"old-etag"',
    lastModified: 'Tue, 14 Jul 2026 00:00:00 GMT',
  })
  strictEqual(dataset.cacheVersion, 2)
  strictEqual(dataset.players?.[0].rating, 1700)
  strictEqual(store.modifiedCommits, 1)
})

Deno.test('XCPC shared cache treats 304 as a successful validation', async () => {
  const store = new MemoryStore(snapshot({ expiresAt: timestamp(-1) }))
  const loader = createXcpcSharedCacheLoader(
    store,
    () =>
      Promise.resolve({
        kind: 'not_modified',
        etag: '"validated-etag"',
        lastModified: null,
      }),
    OPTIONS,
  )

  const dataset = await loader()
  strictEqual(dataset.cacheVersion, 1)
  strictEqual(store.notModifiedCommits, 1)
  strictEqual(store.modifiedCommits, 0)
})

Deno.test('XCPC shared cache never reports stale data as a successful refresh', async () => {
  const store = new MemoryStore(snapshot({ expiresAt: timestamp(-1) }))
  const loader = createXcpcSharedCacheLoader(
    store,
    () => Promise.reject(new HttpError('upstream unavailable', 'source_unavailable', true)),
    OPTIONS,
  )

  await rejects(loader(), /upstream unavailable/)
  deepStrictEqual(store.failures, [{ code: 'source_unavailable', message: 'upstream unavailable' }])
  strictEqual(store.current.activeVersion, 1)
  strictEqual(store.modifiedCommits, 0)
})

Deno.test('XCPC shared cache waits for another lease owner to publish fresh data', async () => {
  const store = new MemoryStore(snapshot({ expiresAt: timestamp(-1) }))
  store.acquireResults.push({
    acquired: false,
    reason: 'leased',
    activeVersion: 1,
    etag: store.current.etag,
    lastModified: store.current.lastModified,
    expiresAt: store.current.expiresAt,
    refreshLeaseExpiresAt: timestamp(30_000),
    refreshRetryAfter: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  })
  const originalRead = store.read.bind(store)
  store.read = async () => {
    const value = await originalRead()
    if (store.reads === 2) store.current.expiresAt = timestamp(60_000)
    return store.reads === 2 ? structuredClone(store.current) : value
  }
  const loader = createXcpcSharedCacheLoader(
    store,
    () => Promise.reject(new Error('waiter must not refresh')),
    OPTIONS,
  )

  const dataset = await loader()
  strictEqual(dataset.cacheVersion, 1)
  strictEqual(store.acquires, 1)
})

Deno.test('XCPC shared cache surfaces the refresh cooldown without stale success', async () => {
  const store = new MemoryStore(snapshot({ expiresAt: timestamp(-1) }))
  store.acquireResults.push({
    acquired: false,
    reason: 'cooldown',
    activeVersion: 1,
    etag: store.current.etag,
    lastModified: store.current.lastModified,
    expiresAt: store.current.expiresAt,
    refreshLeaseExpiresAt: null,
    refreshRetryAfter: timestamp(30_000),
    lastErrorCode: 'rate_limited',
    lastErrorMessage: 'upstream rate limited',
  })
  const loader = createXcpcSharedCacheLoader(
    store,
    () => Promise.reject(new Error('cooldown must skip source loading')),
    OPTIONS,
  )

  await rejects(loader(), /upstream rate limited/)
})

Deno.test('XCPC source preparation keeps only the target school and derives historical max', () => {
  const records = prepareXcpcCachedPlayers(
    {
      players: [
        {
          ...PLAYER,
          teamMember: 'Ａ　Ｂ',
          history: [
            [1, 1, -100, 1400],
            [2, 2, 75, 1475],
          ],
        },
        { ...PLAYER, id: 'xcpc_2222222222222222', organization: '苏州大学' },
      ],
    },
    1,
  )

  deepStrictEqual(records, [
    {
      player_id: PLAYER.id,
      normalized_name: 'A B',
      display_name: 'A B',
      organization: XCPC_TARGET_ORGANIZATION,
      rating: PLAYER.rating,
      max_rating: 1475,
      contests: PLAYER.contests,
    },
  ])
})

Deno.test('XCPC conditional request sends validators and accepts 304', async () => {
  let requestHeaders = new Headers()
  const fetcher: typeof fetch = (_input, init) => {
    requestHeaders = new Headers(init?.headers)
    return Promise.resolve(
      new Response(null, {
        status: 304,
        headers: { etag: '"new-etag"' },
      }),
    )
  }

  const result = await loadXcpcRemoteSource(
    {
      etag: '"old-etag"',
      lastModified: 'Tue, 14 Jul 2026 00:00:00 GMT',
    },
    undefined,
    { url: 'https://example.test/data.js', fetcher },
  )

  strictEqual(requestHeaders.get('if-none-match'), '"old-etag"')
  strictEqual(requestHeaders.get('if-modified-since'), 'Tue, 14 Jul 2026 00:00:00 GMT')
  deepStrictEqual(result, {
    kind: 'not_modified',
    etag: '"new-etag"',
    lastModified: null,
  })
})

Deno.test('XCPC source size guard rejects oversized responses before parsing', async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(
      new Response('too large', {
        status: 200,
        headers: { 'content-length': '2048' },
      }),
    )

  await rejects(
    loadXcpcRemoteSource({ etag: null, lastModified: null }, undefined, {
      url: 'https://example.test/data.js',
      maximumBytes: 1024,
      minimumSourcePlayers: 1,
      fetcher,
    }),
    /size limit/,
  )
})
