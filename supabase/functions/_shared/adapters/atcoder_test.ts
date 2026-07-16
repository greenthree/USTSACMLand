import { deepStrictEqual, equal } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import { createAtCoderAdapter, parseAtCoderAcRank, type AtCoderTransport } from './atcoder.ts'

function transport(overrides: Partial<AtCoderTransport> = {}): AtCoderTransport {
  return {
    fetchHistory: () =>
      Promise.resolve([
        { IsRated: true, NewRating: 1200, EndTime: '2026-01-01T12:00:00+09:00' },
        { IsRated: true, NewRating: 1350, EndTime: '2026-02-01T12:00:00+09:00' },
        { IsRated: true, NewRating: 1300, EndTime: '2026-03-01T12:00:00+09:00' },
      ]),
    fetchAcRank: () => Promise.resolve({ count: 321, rank: 4567 }),
    verifyProfile: () => Promise.resolve(),
    ...overrides,
  }
}

Deno.test('AtCoder AC rank parser reads count and rank', () => {
  deepStrictEqual(parseAtCoderAcRank({ count: 1057, rank: 4349 }), {
    count: 1057,
    rank: 4349,
  })
})

Deno.test('AtCoder adapter combines rating history and solved count', async () => {
  const result = await createAtCoderAdapter(transport()).sync('test_user')

  equal(result.ok, true)
  if (!result.ok) return
  deepStrictEqual(result.metrics, {
    currentRating: 1300,
    maxRating: 1350,
    solvedCount: 321,
  })
  equal(result.sourceVersion, 'atcoder-history-ac-rank-v2')
  deepStrictEqual(result.details, { ratedContestCount: 3, acRank: 4567 })
})

Deno.test(
  'AtCoder adapter treats a valid profile missing from AC rank as zero solved',
  async () => {
    let profileChecks = 0
    const result = await createAtCoderAdapter(
      transport({
        fetchHistory: () => Promise.resolve([]),
        fetchAcRank: () => {
          throw new HttpError('HTTP 404', 'not_found', false, 404)
        },
        verifyProfile: () => {
          profileChecks += 1
          return Promise.resolve()
        },
      }),
    ).sync('unrated_user')

    equal(result.ok, true)
    if (!result.ok) return
    deepStrictEqual(result.metrics, {
      currentRating: null,
      maxRating: null,
      solvedCount: 0,
    })
    equal(profileChecks, 1)
  },
)

Deno.test('AtCoder adapter preserves not-found when neither rank nor profile exists', async () => {
  const result = await createAtCoderAdapter(
    transport({
      fetchHistory: () => Promise.resolve([]),
      fetchAcRank: () => {
        throw new HttpError('HTTP 404', 'not_found', false, 404)
      },
      verifyProfile: () => {
        throw new HttpError('HTTP 404', 'not_found', false, 404)
      },
    }),
  ).sync('missing_user')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'not_found')
})

Deno.test('AtCoder adapter rejects malformed AC rank counts', async () => {
  const result = await createAtCoderAdapter(
    transport({ fetchAcRank: () => Promise.resolve({ count: -1, rank: 1 }) }),
  ).sync('test_user')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
})

for (const [name, history] of [
  ['non-array history', { contests: [] }],
  ['null history entry', [null]],
  ['missing rated flag', [{ NewRating: 1200, EndTime: '2026-01-01T12:00:00+09:00' }]],
  [
    'non-numeric rated Rating',
    [{ IsRated: true, NewRating: '1200', EndTime: '2026-01-01T12:00:00+09:00' }],
  ],
  ['invalid rated contest time', [{ IsRated: true, NewRating: 1200, EndTime: 'not-a-date' }]],
] as const) {
  Deno.test(`AtCoder adapter rejects ${name} as a schema change`, async () => {
    const result = await createAtCoderAdapter(
      transport({ fetchHistory: () => Promise.resolve(history) }),
    ).sync('test_user')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'schema_changed')
    equal(result.error.retryable, false)
  })
}

Deno.test('AtCoder adapter rejects out-of-order rated history', async () => {
  const result = await createAtCoderAdapter(
    transport({
      fetchHistory: () =>
        Promise.resolve([
          { IsRated: true, NewRating: 1300, EndTime: '2026-03-01T12:00:00+09:00' },
          { IsRated: true, NewRating: 1200, EndTime: '2026-01-01T12:00:00+09:00' },
        ]),
    }),
  ).sync('test_user')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
  equal(result.error.retryable, false)
})

Deno.test('AtCoder adapter rejects invalid usernames before requesting data', async () => {
  let requests = 0
  const result = await createAtCoderAdapter(
    transport({
      fetchHistory: () => {
        requests += 1
        return Promise.resolve([])
      },
      fetchAcRank: () => {
        requests += 1
        return Promise.resolve({ count: 0 })
      },
    }),
  ).sync('invalid-user')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'invalid_account')
  equal(requests, 0)
})
