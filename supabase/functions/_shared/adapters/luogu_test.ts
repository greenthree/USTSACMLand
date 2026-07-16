import { deepStrictEqual, equal, match } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import {
  createLuoguAdapter,
  parseLuoguProfile,
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
  return { id, submitTime, problem: { pid } }
}

function page(entries: TestRecord[], count?: number): unknown {
  return {
    currentData: {
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
      fetchProfile(accountId) {
        return Promise.resolve({ currentData: { user: { uid: Number(accountId) } } })
      },
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

Deno.test('Luogu first synchronization reads the full accepted history', async () => {
  const { transport, requests } = transportFromPages([
    page([entry(103, 'P1000'), entry(102, 'B2000'), entry(101, 'CF1000')], 5),
    page([entry(100, 'P1000'), entry(99, 'B2001')], 5),
  ])
  const result = await adapter(transport).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 3)
  equal(result.sourceVersion, 'luogu-authenticated-profile-record-list-pb-v3')
  deepStrictEqual(result.details, {
    provider: 'authenticated_record_list',
    statistic: 'unique currentData.records.result[].problem.pid',
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
    requiredSecrets: ['LUOGU_COOKIE', 'LUOGU_CSRF_TOKEN'],
  })
})

for (const status of [401, 403]) {
  Deno.test(`Luogu adapter maps HTTP ${status} to expired authentication`, async () => {
    const transport: LuoguTransport = {
      fetchProfile() {
        throw new HttpError(`HTTP ${status}`, 'source_unavailable', false, status)
      },
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
    fetchProfile() {
      throw new HttpError('HTTP 429', 'rate_limited', true, 429)
    },
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
    { currentData: {} },
    { currentData: { records: {} } },
    { currentData: { records: { result: {}, count: 0 } } },
    { currentData: { records: { result: [null], count: 1 } } },
    { currentData: { records: { result: [{ problem: null }], count: 1 } } },
    {
      currentData: {
        records: { result: [{ id: 1, submitTime: 1, problem: { pid: 1000 } }], count: 1 },
      },
    },
    {
      currentData: {
        records: { result: [{ id: 'bad', submitTime: 1, problem: { pid: 'P1000' } }], count: 1 },
      },
    },
    {
      currentData: {
        records: { result: [{ id: 1, submitTime: '1', problem: { pid: 'P1000' } }], count: 1 },
      },
    },
    { currentData: { records: { result: [], count: '0' } } },
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
    fetchProfile() {
      requests += 1
      throw new Error('should not run')
    },
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

Deno.test('Luogu profile parser distinguishes valid, missing, and mismatched users', () => {
  parseLuoguProfile({ currentData: { user: { uid: 409073 } } }, '409073')

  for (const [payload, code] of [
    [{ currentData: { errorCode: 404 } }, 'not_found'],
    [{ currentData: { user: { uid: 409074 } } }, 'invalid_account'],
    [{ currentData: { user: {} } }, 'schema_changed'],
  ] as const) {
    try {
      parseLuoguProfile(payload, '409073')
      throw new Error('expected parser failure')
    } catch (error) {
      equal(error instanceof HttpError ? error.code : null, code)
    }
  }
})

Deno.test('Luogu adapter rejects a missing UID before reading Accepted records', async () => {
  let recordRequests = 0
  const transport: LuoguTransport = {
    fetchProfile() {
      throw new HttpError('Luogu user was not found', 'not_found', false, 404)
    },
    fetchRecordPage() {
      recordRequests += 1
      return Promise.resolve(page([], 0))
    },
  }
  const result = await adapter(transport).sync('999999999')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'not_found')
  equal(recordRequests, 0)
})
