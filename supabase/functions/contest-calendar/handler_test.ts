// deno-lint-ignore-file require-await
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  createContestCalendarHandler,
  defaultContestWindow,
  parseContestWindow,
  type ContestCalendarHandlerDependencies,
} from './handler.ts'
const now = new Date('2026-09-07T04:00:00.000Z')
const base = ['https:', '', 'example.test'].join('/')
const href = ['https:', '', 'codeforces.com/contest/1'].join('/')
const query = '?start=2026-09-04T16:00:00.000Z&end=2026-09-21T15:59:59.999Z'
const payload = {
  objects: {
    contest: [
      {
        id: 1,
        resource: 'codeforces.com',
        event: 'Codeforces Round (Div. 3)',
        start: '2026-09-08T12:00:00Z',
        end: '2026-09-08T14:00:00Z',
        href,
      },
    ],
  },
}
function dependencies(
  overrides: Partial<ContestCalendarHandlerDependencies> = {},
): ContestCalendarHandlerDependencies {
  return { fetchCalendarApi: async () => payload, now: () => now, ...overrides }
}
function request(path = `/${query}`): Request {
  return new Request(new URL(path, base).toString())
}
Deno.test('default window uses Beijing calendar boundaries', () => {
  const window = defaultContestWindow(now)
  strictEqual(window.startAt.toISOString(), '2026-09-04T16:00:00.000Z')
  strictEqual(window.endAt.toISOString(), '2026-09-21T15:59:59.999Z')
})
Deno.test('contest calendar validates bounded query windows', () => {
  const parsed = parseContestWindow(
    request('/?start=2026-09-06T00:00:00.000Z&end=2026-09-20T23:59:59.000Z'),
    now,
  )
  strictEqual(parsed.startAt.toISOString(), '2026-09-06T00:00:00.000Z')
  strictEqual(parsed.endAt.toISOString(), '2026-09-20T23:59:59.000Z')
})
Deno.test('contest calendar returns API events and handles method errors', async () => {
  const handler = createContestCalendarHandler(dependencies())
  const response = await handler(request())
  strictEqual(response.status, 200)
  deepStrictEqual(await response.json(), {
    events: [
      {
        id: 'codeforces.com:1',
        name: 'Codeforces Round (Div. 3)',
        platform: 'codeforces.com',
        url: href,
        startAt: '2026-09-08T12:00:00.000Z',
        endAt: '2026-09-08T14:00:00.000Z',
        introductory: true,
      },
    ],
    fetchedAt: now.toISOString(),
    windowStart: '2026-09-04T16:00:00.000Z',
    windowEnd: '2026-09-21T15:59:59.999Z',
  })
  strictEqual((await handler(new Request(request().url, { method: 'POST' }))).status, 405)
  strictEqual((await handler(new Request(request().url, { method: 'OPTIONS' }))).status, 204)
})
Deno.test('contest calendar accepts the default window and caches it for one hour', async () => {
  let fetchCalls = 0
  const handler = createContestCalendarHandler(
    dependencies({
      fetchCalendarApi: async () => {
        fetchCalls += 1
        return payload
      },
    }),
  )
  const first = await handler(new Request(new URL('/', base)))
  const second = await handler(new Request(new URL('/', base)))
  strictEqual(first.status, 200)
  strictEqual(second.status, 200)
  strictEqual(fetchCalls, 1)
  strictEqual(
    first.headers.get('cache-control'),
    'public, max-age=300, s-maxage=3600, stale-while-revalidate=300',
  )
})
Deno.test('contest calendar redacts upstream failures and malformed windows', async () => {
  const handler = createContestCalendarHandler(
    dependencies({
      fetchCalendarApi: async () => {
        throw new Error('private upstream detail')
      },
    }),
  )
  const failed = await handler(request())
  strictEqual(failed.status, 503)
  strictEqual((await failed.text()).includes('private upstream detail'), false)
  strictEqual((await handler(request('/?foo=bar'))).status, 400)
})
