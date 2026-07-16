import { deepStrictEqual, equal } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import { createCodeforcesAdapter, type CodeforcesTransport } from './codeforces.ts'

const validUserInfo = {
  status: 'OK',
  result: [{ handle: 'CanonicalHandle', rating: 1540, maxRating: 1688 }],
}

function transport(overrides: Partial<CodeforcesTransport> = {}): CodeforcesTransport {
  return {
    fetchUserInfo: () => Promise.resolve(validUserInfo),
    fetchSubmissions: () => Promise.resolve({ status: 'OK', result: [] }),
    ...overrides,
  }
}

Deno.test('Codeforces adapter paginates and deduplicates stable accepted problem IDs', async () => {
  const pages: number[] = []
  const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
    verdict: 'OK',
    problem: { contestId: index + 1, index: 'A' },
  }))
  const result = await createCodeforcesAdapter({
    maxPages: 2,
    transport: transport({
      fetchSubmissions: (_accountId, from, count) => {
        pages.push(from)
        equal(count, 1_000)
        return Promise.resolve({
          status: 'OK',
          result:
            from === 1
              ? firstPage
              : [
                  { verdict: 'OK', problem: { contestId: 1, index: 'A' } },
                  { verdict: 'OK', problem: { problemsetName: 'acmsguru', index: '100' } },
                  { verdict: 'WRONG_ANSWER', problem: { contestId: 2_000, index: 'B' } },
                ],
        })
      },
    }),
  }).sync('canonicalhandle')

  equal(result.ok, true)
  if (!result.ok) return
  equal(result.accountId, 'CanonicalHandle')
  deepStrictEqual(result.metrics, {
    currentRating: 1540,
    maxRating: 1688,
    solvedCount: 1_001,
  })
  deepStrictEqual(result.details, { pagesRead: 2 })
  deepStrictEqual(pages, [1, 1_001])
})

Deno.test('Codeforces adapter treats an unrated account as valid null Rating data', async () => {
  const result = await createCodeforcesAdapter({
    maxPages: 1,
    transport: transport({
      fetchUserInfo: () => Promise.resolve({ status: 'OK', result: [{ handle: 'UnratedUser' }] }),
    }),
  }).sync('UnratedUser')

  equal(result.ok, true)
  if (!result.ok) return
  deepStrictEqual(result.metrics, {
    currentRating: null,
    maxRating: null,
    solvedCount: 0,
  })
})

Deno.test('Codeforces adapter preserves API not-found without requesting submissions', async () => {
  let submissionRequests = 0
  const result = await createCodeforcesAdapter({
    maxPages: 1,
    transport: transport({
      fetchUserInfo: () =>
        Promise.resolve({
          status: 'FAILED',
          comment: 'handles: User with handle missing not found',
        }),
      fetchSubmissions: () => {
        submissionRequests += 1
        return Promise.resolve({ status: 'OK', result: [] })
      },
    }),
  }).sync('missing')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'not_found')
  equal(result.error.retryable, false)
  equal(submissionRequests, 0)
})

Deno.test('Codeforces adapter preserves API rate limits as retryable failures', async () => {
  const result = await createCodeforcesAdapter({
    maxPages: 1,
    transport: transport({
      fetchSubmissions: () => Promise.resolve({ status: 'FAILED', comment: 'Call limit exceeded' }),
    }),
  }).sync('RateLimited')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'rate_limited')
  equal(result.error.retryable, true)
})

Deno.test('Codeforces adapter classifies malformed user responses as schema changes', async () => {
  const result = await createCodeforcesAdapter({
    maxPages: 1,
    transport: transport({ fetchUserInfo: () => Promise.resolve(null) }),
  }).sync('SchemaUser')

  equal(result.ok, false)
  if (result.ok) return
  equal(result.error.code, 'schema_changed')
  equal(result.error.retryable, false)
  deepStrictEqual(result.error.details, { endpoint: 'user.info' })
})

Deno.test(
  'Codeforces adapter rejects a malformed submission result without undercounting',
  async () => {
    const result = await createCodeforcesAdapter({
      maxPages: 1,
      transport: transport({
        fetchSubmissions: () => Promise.resolve({ status: 'OK', result: { submissions: [] } }),
      }),
    }).sync('SchemaUser')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'schema_changed')
    equal(result.error.retryable, false)
    deepStrictEqual(result.error.details, { endpoint: 'user.status' })
  },
)

Deno.test(
  'Codeforces adapter rejects Accepted submissions without stable problem identity',
  async () => {
    const result = await createCodeforcesAdapter({
      maxPages: 1,
      transport: transport({
        fetchSubmissions: () =>
          Promise.resolve({
            status: 'OK',
            result: [{ verdict: 'OK', problem: { name: 'Missing index' } }],
          }),
      }),
    }).sync('SchemaUser')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'schema_changed')
    equal(result.error.retryable, false)
  },
)

Deno.test(
  'Codeforces adapter fails closed when the pagination safety limit is reached',
  async () => {
    const result = await createCodeforcesAdapter({
      maxPages: 1,
      transport: transport({
        fetchSubmissions: () =>
          Promise.resolve({
            status: 'OK',
            result: Array.from({ length: 1_000 }, (_, index) => ({
              verdict: 'OK',
              problem: { contestId: index + 1, index: 'A' },
            })),
          }),
      }),
    }).sync('LongHistory')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'source_unavailable')
    equal(result.error.retryable, false)
    deepStrictEqual(result.error.details, { pagesRead: 1, pageSize: 1_000 })
  },
)

Deno.test(
  'Codeforces adapter never returns partial statistics when a later page fails',
  async () => {
    let requests = 0
    const result = await createCodeforcesAdapter({
      maxPages: 2,
      transport: transport({
        fetchSubmissions: () => {
          requests += 1
          if (requests === 1) {
            return Promise.resolve({
              status: 'OK',
              result: Array.from({ length: 1_000 }, (_, index) => ({
                verdict: 'OK',
                problem: { contestId: index + 1, index: 'A' },
              })),
            })
          }
          throw new HttpError('Second page timed out', 'timeout', true)
        },
      }),
    }).sync('AtomicHistory')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'timeout')
    equal(result.error.retryable, true)
    equal(requests, 2)
  },
)

Deno.test(
  'Codeforces adapter recovers structured API failures from HTTP response bodies',
  async () => {
    const result = await createCodeforcesAdapter({
      maxPages: 1,
      transport: transport({
        fetchUserInfo: () => {
          throw new HttpError(
            'Upstream returned HTTP 400',
            'source_unavailable',
            false,
            400,
            JSON.stringify({ status: 'FAILED', comment: 'User not found' }),
          )
        },
      }),
    }).sync('MissingOverHttp')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'not_found')
    equal(result.error.retryable, false)
  },
)

Deno.test(
  'Codeforces adapter preserves normalized transport failures and diagnostics',
  async () => {
    const result = await createCodeforcesAdapter({
      maxPages: 1,
      transport: transport({
        fetchUserInfo: () => {
          throw new HttpError('Request timed out', 'timeout', true, undefined, undefined, {
            attempt: 3,
          })
        },
      }),
    }).sync('TimeoutUser')

    equal(result.ok, false)
    if (result.ok) return
    equal(result.error.code, 'timeout')
    equal(result.error.retryable, true)
    deepStrictEqual(result.error.details, { attempt: 3 })
  },
)
