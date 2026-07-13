import { strictEqual } from 'node:assert/strict'
import { freshnessDeadline, retainedFreshness } from './freshness.ts'

Deno.test('twice-daily platforms expire after the next scheduled window', () => {
  const successfulAt = '2026-07-13T05:56:31.000Z'
  const expected = '2026-07-13T13:00:00.000Z'

  for (const platform of ['codeforces', 'nowcoder', 'luogu', 'atcoder'] as const) {
    strictEqual(freshnessDeadline(platform, successfulAt), expected)
  }
})

Deno.test('a late daily success remains fresh until the following morning window', () => {
  strictEqual(
    freshnessDeadline('codeforces', '2026-07-13T12:38:45.000Z'),
    '2026-07-14T01:00:00.000Z',
  )
})

Deno.test('weekly platforms expire one day after the next Tuesday window', () => {
  const successfulAt = '2026-07-13T12:38:36.000Z'
  const expected = '2026-07-15T00:00:00.000Z'

  for (const platform of ['xcpc_elo', 'qoj'] as const) {
    strictEqual(freshnessDeadline(platform, successfulAt), expected)
  }
})

Deno.test('a failed attempt only marks retained data stale after its scheduled deadline', () => {
  const lastSuccessAt = '2026-07-13T05:56:31.000Z'
  strictEqual(
    retainedFreshness('codeforces', lastSuccessAt, Date.parse('2026-07-13T12:59:59.000Z')).status,
    'fresh',
  )
  strictEqual(
    retainedFreshness('codeforces', lastSuccessAt, Date.parse('2026-07-13T13:00:00.000Z')).status,
    'stale',
  )
  strictEqual(retainedFreshness('codeforces', null).status, 'unavailable')
})
