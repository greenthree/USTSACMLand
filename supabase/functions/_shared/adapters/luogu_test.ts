import { deepStrictEqual, equal, match } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import { createLuoguAdapter, parseLuoguRecordPage, type LuoguTransport } from './luogu.ts'

function record(pid: string): Record<string, unknown> {
  return { problem: { pid } }
}

function page(problemIds: string[], count?: number): unknown {
  return {
    currentData: {
      records: {
        result: problemIds.map(record),
        ...(count === undefined ? {} : { count }),
      },
    },
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

Deno.test('Luogu record parser reads strict accepted-record fields', () => {
  deepStrictEqual(parseLuoguRecordPage(page(['P1000', 'P1001'], 2)), {
    problemIds: ['P1000', 'P1001'],
    recordCount: 2,
    totalRecords: 2,
  })
})

Deno.test('Luogu adapter returns zero for an empty accepted record list', async () => {
  const { transport, requests } = transportFromPages([page([], 0)])
  const result = await createLuoguAdapter({ transport }).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 0)
  equal(result.sourceVersion, 'luogu-authenticated-record-list-pb-v1')
  deepStrictEqual(result.details, {
    provider: 'authenticated_record_list',
    statistic: 'unique currentData.records.result[].problem.pid',
    pidPrefixes: ['P', 'B'],
    pagesRead: 1,
    recordsRead: 0,
  })
  deepStrictEqual(requests, [{ accountId: '409073', page: 1 }])
})

Deno.test('Luogu adapter deduplicates accepted problem PIDs across pages', async () => {
  const { transport, requests } = transportFromPages([
    page(['P1000', 'B2000', 'CF1000'], 6),
    page(['p1000', 'B2001', 'UVA1000'], 6),
  ])
  const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 3)
  deepStrictEqual(result.details?.pagesRead, 2)
  deepStrictEqual(requests, [
    { accountId: '409073', page: 1 },
    { accountId: '409073', page: 2 },
  ])
})

Deno.test('Luogu adapter counts only P- and B-prefixed accepted problems', async () => {
  const { transport } = transportFromPages([
    page(['P1000', 'B2000', 'CF1000', 'UVA1000', 'AT_abc001_a'], 5),
  ])
  const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 2)
  deepStrictEqual(result.details?.pidPrefixes, ['P', 'B'])
})

Deno.test('Luogu adapter continues until an empty page when no total is present', async () => {
  const { transport, requests } = transportFromPages([
    page(['P1000']),
    page(['P1000', 'P1001']),
    page([]),
  ])
  const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.metrics.solvedCount, 2)
  equal(requests.length, 3)
})

Deno.test('Luogu adapter reports missing authentication as not configured', async () => {
  const result = await createLuoguAdapter({ transport: null }).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'not_configured')
  deepStrictEqual(result.error.details, {
    requiredSecrets: ['LUOGU_COOKIE', 'LUOGU_CSRF_TOKEN'],
  })
})

for (const status of [401, 403]) {
  Deno.test(`Luogu adapter maps HTTP ${status} to expired authentication`, async () => {
    const transport: LuoguTransport = {
      fetchRecordPage() {
        throw new HttpError(`HTTP ${status}`, 'source_unavailable', false, status)
      },
    }
    const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')

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
  const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')

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
    { currentData: { records: { result: [{ problem: { pid: 1000 } }], count: 1 } } },
    { currentData: { records: { result: [], count: '0' } } },
  ]

  for (const payload of malformedPages) {
    const { transport } = transportFromPages([payload])
    const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')
    equal(result.ok, false)
    if (!result.ok) equal(result.error.code, 'schema_changed')
  }
})

Deno.test('Luogu adapter fails instead of returning a partial count at max pages', async () => {
  const { transport, requests } = transportFromPages([page(['P1000', 'P1001']), page(['P1002'])])
  const result = await createLuoguAdapter({ transport, maxPages: 2 }).sync('409073')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'source_unavailable')
  equal(result.error.retryable, false)
  match(result.error.message, /2-page safety limit/)
  equal(requests.length, 2)
})

Deno.test('Luogu adapter rejects an empty page before a declared total is complete', async () => {
  const { transport } = transportFromPages([page(['P1000'], 2), page([], 2)])
  const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('409073')

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
  const result = await createLuoguAdapter({ transport, maxPages: 5 }).sync('user-name')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'invalid_account')
  equal(requests, 0)
})
