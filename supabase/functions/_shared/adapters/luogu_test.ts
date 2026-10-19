import { deepStrictEqual, equal, match } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import {
  createLuoguAdapter,
  createFirecrawlLuoguTransport,
  parseFirecrawlLuoguPage,
  parseLuoguJsonResponse,
  parseLuoguRecordPage,
  type LuoguSyncState,
  type LuoguTransport,
} from './luogu.ts'

interface TestRecord {
  id: number | string
  submitTime: number
  pid: string
}

const NOW = new Date('2026-07-14T00:00:00Z')

function record(pid: string, id: number | string, submitTime: number): Record<string, unknown> {
  return { id, submitTime, status: 12, problem: { pid } }
}

function page(entries: TestRecord[], count?: number): unknown {
  return {
    template: 'record.list',
    data: {
      records: {
        result: entries.map((entry) => record(entry.pid, entry.id, entry.submitTime)),
        ...(count === undefined ? {} : { count }),
      },
    },
  }
}

function entry(id: number, pid: string, submitTime = id): TestRecord {
  return { id, pid, submitTime }
}

function state(overrides: Partial<LuoguSyncState> = {}): LuoguSyncState {
  return {
    accountId: '409073',
    boundaryRecordId: '100',
    boundarySubmitTime: 100,
    totalRecords: 1,
    problemIds: ['P1000'],
    lastFullSyncAt: '2026-07-13T00:00:00Z',
    ...overrides,
  }
}

function transportFromPages(pages: unknown[]): {
  transport: LuoguTransport
  requests: Array<{ accountId: string; page: number }>
} {
  const requests: Array<{ accountId: string; page: number }> = []
  return {
    requests,
    transport: {
      fetchRecordPage(accountId, pageNumber) {
        requests.push({ accountId, page: pageNumber })
        const payload = pages[pageNumber - 1]
        if (payload === undefined) throw new Error(`unexpected page ${pageNumber}`)
        return Promise.resolve(payload)
      },
    },
  }
}

function adapter(transport: LuoguTransport, maxPages = 5) {
  return createLuoguAdapter({ transport, maxPages, now: () => NOW })
}

Deno.test('Luogu record parser reads stable IDs, submit times, and problem IDs', () => {
  deepStrictEqual(parseLuoguRecordPage(page([entry(102, 'P1000'), entry(101, 'P1001')], 2)), {
    records: [
      { id: '102', submitTime: 102, problemId: 'P1000' },
      { id: '101', submitTime: 101, problemId: 'P1001' },
    ],
    recordCount: 2,
    totalRecords: 2,
  })
})

Deno.test('Luogu record parser recognizes a missing UID without a profile request', () => {
  try {
    parseLuoguRecordPage({ template: 'error', data: { errorCode: 404 } })
    throw new Error('expected parser failure')
  } catch (error) {
    equal(error instanceof HttpError ? error.code : null, 'not_found')
  }
})

function scrape(payload: unknown, pageNumber = 1, statusCode = 200) {
  return {
    success: true,
    data: {
      metadata: {
        statusCode,
        url: `https://www.luogu.com.cn/record/list?user=409073&page=${pageNumber}&status=12`,
      },
      rawHtml: `<!doctype html><script id="lentille-context" type="application/json">${JSON.stringify(payload)}</script>`,
    },
  }
}

Deno.test(
  'Luogu Firecrawl transport requests uncached Accepted pages without inline retries',
  async () => {
    let requests = 0
    const transport = createFirecrawlLuoguTransport(
      'synthetic-key',
      'synthetic-cookie',
      'synthetic-csrf',
      undefined,
      (input, options) => {
        requests += 1
        equal(input, 'https://api.firecrawl.dev/v2/scrape')
        equal(options.retries, 0)
        equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-key')
        deepStrictEqual(JSON.parse(options.body as string), {
          url: 'https://www.luogu.com.cn/record/list?user=409073&page=2&status=12',
          formats: ['rawHtml'],
          onlyMainContent: false,
          headers: { cookie: 'synthetic-cookie', 'x-csrf-token': 'synthetic-csrf' },
          timeout: 60_000,
          maxAge: 0,
          storeInCache: false,
          proxy: 'basic',
        })
        return Promise.resolve(scrape(page([entry(101, 'P1000')], 1), 2))
      },
    )
    const result = parseLuoguRecordPage(await transport.fetchRecordPage('409073', 2))
    equal(result.records[0].problemId, 'P1000')
    equal(requests, 1)
  },
)

Deno.test(
  'Luogu transport fails closed on HTML without retrying or returning a checkpoint',
  async () => {
    let requests = 0
    const transport = createFirecrawlLuoguTransport(
      'synthetic-key',
      'synthetic-cookie',
      'synthetic-csrf',
      undefined,
      () => {
        requests += 1
        const payload = scrape({})
        payload.data.rawHtml = '<!doctype html><title>Record list</title>'
        return Promise.resolve(payload)
      },
    )
    const result = await adapter(transport).sync('409073', { syncState: state() })
    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'source_unavailable')
    equal(result.error.retryable, false)
    equal(result.error.details?.responseKind, 'other_html')
    equal('syncState' in result, false)
    equal(requests, 1)
  },
)

Deno.test('Luogu record parser rejects legacy and unrelated page envelopes', () => {
  const records = { result: [record('P1000', 101, 101)], count: 1 }
  for (const payload of [
    { currentData: { records } },
    { records },
    { data: { records } },
    { template: 'user.practice', data: { records } },
  ]) {
    try {
      parseLuoguRecordPage(payload)
      throw new Error('expected parser failure')
    } catch (error) {
      equal(error instanceof HttpError ? error.code : null, 'schema_changed')
    }
  }
})

Deno.test(
  'Luogu adapter rejects missing or non-Accepted record status without advancing state',
  async () => {
    for (const status of [undefined, null, '12', 11, 0]) {
      const { transport } = transportFromPages([
        {
          template: 'record.list',
          data: { records: { result: [{ ...record('P1001', 101, 101), status }], count: 1 } },
        },
      ])
      const result = await adapter(transport).sync('409073', { syncState: state() })
      equal(result.ok, false)
      if (result.ok) continue
      equal(result.error.code, 'schema_changed')
      equal(result.error.retryable, false)
      equal('syncState' in result, false)
    }
  },
)

Deno.test('Luogu first synchronization reads the full accepted history', async () => {
  const { transport, requests } = transportFromPages([
    page([entry(103, 'P1000'), entry(102, 'B2000'), entry(101, 'CF1000')], 5),
    page([entry(100, 'P1000'), entry(99, 'B2001')], 5),
  ])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 3)
  equal(result.sourceVersion, 'luogu-firecrawl-lentille-pb-v6')
  deepStrictEqual(result.details, {
    provider: 'firecrawl',
    statistic: 'unique data.records.result[].problem.pid',
    pidPrefixes: ['P', 'B'],
    syncMode: 'full',
    fallbackReason: null,
    pagesRead: 2,
    recordsRead: 5,
    newRecords: 5,
    newProblems: 3,
  })
  deepStrictEqual(result.syncState, {
    accountId: '409073',
    boundaryRecordId: '103',
    boundarySubmitTime: 103,
    totalRecords: 5,
    problemIds: ['B2000', 'B2001', 'P1000'],
    lastFullSyncAt: NOW.toISOString(),
  })
  deepStrictEqual(requests, [
    { accountId: '409073', page: 1 },
    { accountId: '409073', page: 2 },
  ])
})

Deno.test('Luogu adapter returns zero and a checkpoint for an empty history', async () => {
  const { transport } = transportFromPages([page([], 0)])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 0)
  deepStrictEqual(result.syncState, {
    accountId: '409073',
    boundaryRecordId: null,
    boundarySubmitTime: null,
    totalRecords: 0,
    problemIds: [],
    lastFullSyncAt: NOW.toISOString(),
  })
})

Deno.test('Luogu incremental synchronization stops at the exact previous record ID', async () => {
  const { transport, requests } = transportFromPages([
    page([entry(102, 'B2000'), entry(101, 'P1000'), entry(100, 'P1000')], 3),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state({ totalRecords: 1 }),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 2)
  equal(result.details?.syncMode, 'incremental')
  equal(result.details?.newRecords, 2)
  equal(result.details?.newProblems, 1)
  deepStrictEqual(result.syncState, {
    ...state({
      boundaryRecordId: '102',
      boundarySubmitTime: 102,
      totalRecords: 3,
      problemIds: ['B2000', 'P1000'],
    }),
  })
  equal(requests.length, 1)
})

Deno.test('Luogu incremental boundary remains exact when records share a timestamp', async () => {
  const { transport } = transportFromPages([
    page([entry(102, 'B2000', 100), entry(101, 'P1001', 100), entry(100, 'P1000', 100)], 3),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state({ boundarySubmitTime: 100 }),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 3)
  equal(result.details?.newRecords, 2)
})

Deno.test('Luogu repeated AC records do not stop or increase the unique count', async () => {
  const { transport } = transportFromPages([
    page([entry(102, 'P1000'), entry(101, 'B2000'), entry(100, 'P1000')], 3),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state(),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 2)
  equal(result.details?.newProblems, 1)
})

Deno.test(
  'Luogu non-P/B records advance the incremental boundary without changing count',
  async () => {
    const { transport } = transportFromPages([page([entry(101, 'CF1000'), entry(100, 'P1000')], 2)])
    const result = await adapter(transport).sync('409073', {
      syncState: state(),
    })

    equal(result.ok, true)
    if (!result.ok) return
    equal(result.metrics.solvedCount, 1)
    equal(result.details?.newRecords, 1)
    equal(result.details?.newProblems, 0)
    deepStrictEqual((result.syncState as LuoguSyncState).boundaryRecordId, '101')
  },
)

Deno.test('Luogu incremental synchronization can find its boundary on a later page', async () => {
  const { transport, requests } = transportFromPages([
    page([entry(104, 'P1004'), entry(103, 'P1003')], 5),
    page([entry(102, 'B2000'), entry(101, 'P1001'), entry(100, 'P1000')], 5),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state(),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 5)
  equal(result.details?.newRecords, 4)
  equal(requests.length, 2)
})

Deno.test('Luogu total mismatch falls back to a complete rebuild', async () => {
  const { transport, requests } = transportFromPages([
    page(
      [
        entry(104, 'P1004'),
        entry(100, 'P1000'),
        entry(99, 'B2000'),
        entry(98, 'CF1000'),
        entry(97, 'P1001'),
      ],
      5,
    ),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state({ totalRecords: 3 }),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 4)
  equal(result.details?.syncMode, 'rebuild')
  equal(result.details?.fallbackReason, 'record_total_delta_mismatch')
  equal(requests.length, 2)
})

Deno.test('Luogu record total decrease falls back to a complete rebuild', async () => {
  const { transport, requests } = transportFromPages([
    page([entry(100, 'P1000'), entry(99, 'B2000')], 2),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state({ totalRecords: 3 }),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 2)
  equal(result.details?.syncMode, 'rebuild')
  equal(result.details?.fallbackReason, 'record_total_decreased')
  equal(requests.length, 2)
})

Deno.test('Luogu missing boundary rebuilds from the complete history', async () => {
  const { transport } = transportFromPages([
    page([entry(103, 'P1003'), entry(102, 'P1002'), entry(101, 'P1001')], 3),
  ])
  const result = await adapter(transport).sync('409073', {
    syncState: state(),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 3)
  equal(result.details?.syncMode, 'rebuild')
  equal(result.details?.fallbackReason, 'boundary_record_missing')
})

Deno.test('Luogu state for another UID is ignored and rebuilt in full', async () => {
  const { transport } = transportFromPages([page([entry(101, 'P1001')], 1)])
  const result = await adapter(transport).sync('409073', {
    syncState: state({ accountId: '123456' }),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.details?.syncMode, 'full')
  equal(result.metrics.solvedCount, 1)
})

Deno.test('Luogu performs a full reconciliation after thirty days', async () => {
  const { transport } = transportFromPages([page([entry(101, 'P1001')], 1)])
  const result = await adapter(transport).sync('409073', {
    syncState: state({ lastFullSyncAt: '2026-06-01T00:00:00Z' }),
  })

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.details?.syncMode, 'full')
  equal(result.details?.fallbackReason, 'periodic_reconciliation')
})

Deno.test('Luogu adapter rejects records that are not ordered newest first', async () => {
  const { transport } = transportFromPages([
    page([entry(101, 'P1001', 101), entry(102, 'P1002', 102)], 2),
  ])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
})

Deno.test('Luogu adapter rejects a total that changes between pages', async () => {
  const { transport } = transportFromPages([
    page([entry(102, 'P1000')], 2),
    page([entry(101, 'P1001')], 3),
  ])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
  equal(result.error.retryable, false)
  match(result.error.message, /total changed between pages/)
})

Deno.test('Luogu adapter rejects duplicate record IDs across pages', async () => {
  const { transport } = transportFromPages([
    page([entry(102, 'P1000', 102)], 2),
    page([entry(102, 'P1001', 101)], 2),
  ])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
  equal(result.error.retryable, false)
  match(result.error.message, /duplicate record ID/)
})

Deno.test('Luogu adapter rejects more records than the declared total', async () => {
  const { transport } = transportFromPages([page([entry(102, 'P1000'), entry(101, 'P1001')], 1)])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
  equal(result.error.retryable, false)
  match(result.error.message, /more records than its total/)
})

Deno.test('Luogu adapter reports missing authentication as not configured', async () => {
  const result = createLuoguAdapter({ transport: null }).sync('409073')
  const resolved = await result

  equal(resolved.ok, false)
  if (resolved.ok) return
  equal(resolved.error.code, 'not_configured')
  deepStrictEqual(resolved.error.details, {
    requiredSecrets: ['FIRECRAWL_API_KEY', 'LUOGU_COOKIE', 'LUOGU_CSRF_TOKEN'],
  })
})

for (const status of [401, 403]) {
  Deno.test(`Luogu adapter maps HTTP ${status} to expired authentication`, async () => {
    const transport: LuoguTransport = {
      fetchRecordPage() {
        throw new HttpError(`HTTP ${status}`, 'source_unavailable', false, status)
      },
    }
    const result = await adapter(transport).sync('409073')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'auth_expired')
    equal(result.error.retryable, false)
    deepStrictEqual(result.error.details, { httpStatus: status })
  })
}

Deno.test('Luogu adapter preserves rate-limit classification', async () => {
  const transport: LuoguTransport = {
    fetchRecordPage() {
      throw new HttpError('HTTP 429', 'rate_limited', true, 429)
    },
  }
  const result = await adapter(transport).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'rate_limited')
  equal(result.error.retryable, true)
  deepStrictEqual(result.error.details, { httpStatus: 429 })
})

Deno.test('Luogu adapter rejects changed record-list structures', async () => {
  const malformedPages: unknown[] = [
    null,
    {},
    { template: 'record.list', data: {} },
    ...[
      {},
      { result: {}, count: 0 },
      { result: [null], count: 1 },
      { result: [{ ...record('P1000', 1, 1), problem: null }], count: 1 },
      { result: [{ ...record('P1000', 1, 1), problem: { pid: 1000 } }], count: 1 },
      { result: [record('P1000', 'bad', 1)], count: 1 },
      { result: [{ ...record('P1000', 1, 1), submitTime: '1' }], count: 1 },
      { result: [], count: '0' },
    ].map((records) => ({ template: 'record.list', data: { records } })),
  ]

  for (const payload of malformedPages) {
    const { transport } = transportFromPages([payload])
    const result = await adapter(transport).sync('409073')
    equal(result.ok, false)
    if (!result.ok) equal(result.error.code, 'schema_changed')
  }
})

Deno.test('Luogu incremental sync fails instead of advancing an unseen boundary', async () => {
  const { transport, requests } = transportFromPages([
    page([entry(104, 'P1004'), entry(103, 'P1003')]),
    page([entry(102, 'P1002')]),
  ])
  const result = await adapter(transport, 2).sync('409073', { syncState: state() })

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'source_unavailable')
  equal(result.error.retryable, false)
  match(result.error.message, /2-page safety limit/)
  equal(requests.length, 2)
})

Deno.test('Luogu adapter rejects an empty page before a declared total is complete', async () => {
  const { transport } = transportFromPages([page([entry(101, 'P1000')], 2), page([], 2)])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
})

Deno.test('Luogu adapter rejects invalid UIDs before requesting records', async () => {
  let requests = 0
  const transport: LuoguTransport = {
    fetchRecordPage() {
      requests += 1
      throw new Error('should not run')
    },
  }
  const result = await adapter(transport).sync('user-name')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'invalid_account')
  equal(requests, 0)
})

Deno.test('Luogu JSON parser classifies HTML login and challenge pages', () => {
  for (const [body, expectedCode, retryable, responseKind] of [
    ['<!doctype html><title>Login</title>', 'auth_expired', false, 'login'],
    ['<!doctype html><title>Just a moment...</title>', 'source_unavailable', false, 'challenge'],
    [
      '<script>var _$daewqwskl=["\\x64"];</script>',
      'source_unavailable',
      false,
      'script_challenge',
    ],
    ['<!doctype html><title>Record list</title>', 'source_unavailable', false, 'other_html'],
  ] as const) {
    try {
      parseLuoguJsonResponse(body, 200, 'text/html; charset=UTF-8')
      throw new Error('expected parser failure')
    } catch (error) {
      equal(error instanceof HttpError ? error.code : null, expectedCode)
      equal(error instanceof HttpError ? error.retryable : null, retryable)
      equal(error instanceof HttpError ? error.details?.responseKind : null, responseKind)
    }
  }
})

Deno.test('Luogu JSON parser preserves non-HTML schema failures', () => {
  try {
    parseLuoguJsonResponse('not-json', 200, 'application/json')
    throw new Error('expected parser failure')
  } catch (error) {
    equal(error instanceof HttpError ? error.code : null, 'schema_changed')
  }
})

Deno.test('Firecrawl Luogu parser strips viewer state and unrelated record fields', () => {
  const payload = page([entry(101, 'P1000')], 1)
  const result = parseFirecrawlLuoguPage(
    scrape({
      ...(payload as Record<string, unknown>),
      user: { privateViewer: 'synthetic-viewer' },
      csrfToken: 'synthetic-csrf',
    }),
    '409073',
    1,
  )
  deepStrictEqual(result, payload)
  equal(JSON.stringify(result).includes('synthetic-'), false)
})

Deno.test('Firecrawl Luogu parser rejects other users, pages, filters and redirects', () => {
  for (const url of [
    'https://www.luogu.com.cn/record/list?user=1&page=1&status=12',
    'https://www.luogu.com.cn/record/list?user=409073&page=2&status=12',
    'https://www.luogu.com.cn/record/list?user=409073&page=1&status=11',
    'https://www.luogu.com.cn/user/409073',
    'https://example.test/record/list?user=409073&page=1&status=12',
  ]) {
    const payload = scrape(page([], 0))
    payload.data.metadata.url = url
    try {
      parseFirecrawlLuoguPage(payload, '409073', 1)
      throw new Error('expected wrong-page failure')
    } catch (error) {
      equal(error instanceof HttpError ? error.code : null, 'schema_changed')
    }
  }
})

Deno.test('Firecrawl Luogu parser recognizes the observed Lentille login error envelope', () => {
  for (const payload of [
    scrape({ template: 'error', status: 401, data: { errorCode: 401 } }),
    scrape(page([], 0), 1, 403),
    {
      ...scrape(page([], 0)),
      data: {
        ...scrape(page([], 0)).data,
        metadata: { statusCode: 200, url: 'https://www.luogu.com.cn/auth/login' },
      },
    },
  ]) {
    try {
      parseFirecrawlLuoguPage(payload, '409073', 1)
      throw new Error('expected authentication failure')
    } catch (error) {
      equal(error instanceof HttpError ? error.code : null, 'auth_expired')
      equal(error instanceof HttpError ? error.details?.authTarget : null, 'luogu')
      equal(error instanceof HttpError ? error.retryable : null, false)
    }
  }
})

Deno.test('Firecrawl Luogu malformed responses never become empty successful histories', () => {
  const valid = scrape(page([], 0))
  for (const payload of [
    null,
    { success: false },
    { success: true, data: {} },
    {
      ...valid,
      data: {
        ...valid.data,
        rawHtml: '<script id="lentille-context" type="application/json">invalid</script>',
      },
    },
    scrape({ template: 'user.practice', data: { records: { result: [], count: 0 } } }),
    { ...valid, data: { ...valid.data, rawHtml: valid.data.rawHtml + valid.data.rawHtml } },
  ]) {
    try {
      parseFirecrawlLuoguPage(payload, '409073', 1)
      throw new Error('expected invalid-response failure')
    } catch (error) {
      equal(error instanceof HttpError, true)
    }
  }
})

Deno.test('Firecrawl and Luogu authentication failures retain distinct targets', async () => {
  for (const status of [401, 403]) {
    let requests = 0
    const transport = createFirecrawlLuoguTransport(
      'synthetic-key',
      'synthetic-cookie',
      'synthetic-csrf',
      undefined,
      () => {
        requests += 1
        throw new HttpError('synthetic transport error', 'source_unavailable', false, status)
      },
    )
    const result = await adapter(transport).sync('409073', { syncState: state() })
    equal(result.ok, false)
    if (result.ok) continue
    equal(result.error.details?.authTarget, 'firecrawl')
    equal(result.error.code, status === 401 ? 'auth_expired' : 'auth_required')
    equal('syncState' in result, false)
    equal(requests, 1)
  }
})

Deno.test(
  'Firecrawl HTTP 429 identifies the provider without inline retry or advancing state',
  async () => {
    let requests = 0
    const transport = createFirecrawlLuoguTransport(
      'synthetic-key',
      'synthetic-cookie',
      'synthetic-csrf',
      undefined,
      () => {
        requests += 1
        throw new HttpError('upstream body must not escape', 'rate_limited', true, 429)
      },
    )
    const result = await adapter(transport).sync('409073', { syncState: state() })
    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'rate_limited')
    equal(result.error.message, 'Firecrawl rate limit was reached')
    equal(result.error.retryable, true)
    deepStrictEqual(result.error.details, { httpStatus: 429, authTarget: 'firecrawl' })
    equal('syncState' in result, false)
    equal(requests, 1)
  },
)

Deno.test(
  'Luogu upstream rate limits retain old state without being attributed to the Key',
  async () => {
    const transport = createFirecrawlLuoguTransport(
      'synthetic-key',
      'synthetic-cookie',
      'synthetic-csrf',
      undefined,
      () => Promise.resolve(scrape(page([], 0), 1, 429)),
    )
    const result = await adapter(transport).sync('409073', { syncState: state() })
    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'rate_limited')
    equal(result.error.retryable, true)
    equal(result.error.details?.authTarget, 'luogu')
    equal('syncState' in result, false)
  },
)

Deno.test('Luogu HTML diagnostics retain only bounded response structure', () => {
  try {
    parseLuoguJsonResponse(
      '<!doctype html><html><head><script>window.__feConfigVersion = "v"</script></head></html>',
      200,
      'text/html',
      true,
    )
    throw new Error('expected parser failure')
  } catch (error) {
    equal(error instanceof HttpError ? error.code : null, 'source_unavailable')
    deepStrictEqual(error instanceof HttpError ? error.details : null, {
      responseKind: 'other_html',
      htmlShape: 'document',
      sizeBand: 'under_1k',
      luoguPageMarkers: true,
      redirected: true,
    })
  }
})
