import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { isIntroductoryContest, parseContestCalendarApi } from './parser.ts'
const window = {
  startAt: new Date('2026-09-06T00:00:00.000Z'),
  endAt: new Date('2026-09-20T23:59:59.999Z'),
}
const href = ['https:', '', 'codeforces.com/contest/1'].join('/')
Deno.test('parses official clist API contests and filters platform/window', () => {
  const contests = parseContestCalendarApi(
    {
      objects: {
        contest: [
          {
            id: 1,
            resource: 'http/workspace/e34d99267115',
            host: 'codeforces.com',
            event: 'Codeforces Round (Div. 3)',
            start: '2026-09-08T12:00:00Z',
            end: '2026-09-08T14:00:00Z',
            href,
          },
          {
            id: 2,
            resource: 'http/workspace/e34d99267115',
            host: 'unknown.example',
            event: 'Nope',
            start: '2026-09-08T12:00:00Z',
            end: '2026-09-08T14:00:00Z',
            href,
          },
          {
            id: 3,
            resource: 'http/workspace/e34d99267115',
            host: 'atcoder.jp',
            event: 'AtCoder Beginner Contest 475',
            start: '2026-09-01T12:00:00Z',
            duration: '2 hours',
            href,
          },
        ],
      },
    },
    window,
  )
  strictEqual(contests.length, 1)
  deepStrictEqual(contests[0], {
    id: 'codeforces.com:1',
    name: 'Codeforces Round (Div. 3)',
    platform: 'codeforces.com',
    url: href,
    startAt: '2026-09-08T12:00:00.000Z',
    endAt: '2026-09-08T14:00:00.000Z',
  })
})
Deno.test('marks introductory contest names', () => {
  strictEqual(isIntroductoryContest('Codeforces Round (Div. 4)'), true)
  strictEqual(isIntroductoryContest('AtCoder Beginner Contest 475'), true)
  strictEqual(isIntroductoryContest('Codeforces Round (Div. 2)'), false)
})

Deno.test('accepts the flat objects array returned by clist API clients', () => {
  const contests = parseContestCalendarApi(
    {
      objects: [
        {
          id: 7,
          host: 'codeforces.com',
          resource: 'http/workspace/e34d99267115',
          event: 'Codeforces Round (Div. 4)',
          start: '2026-09-09T12:00:00Z',
          end: '2026-09-09T14:00:00Z',
          href,
        },
      ],
    },
    window,
  )
  strictEqual(contests.length, 1)
  strictEqual(contests[0].id, 'codeforces.com:7')
})
