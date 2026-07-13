import { strictEqual } from 'node:assert/strict'
import { freshnessDeadline } from './freshness.ts'

Deno.test('twice-daily platforms remain fresh for fourteen hours', () => {
  const fetchedAt = '2026-07-13T11:00:00.000Z'
  const expected = '2026-07-14T01:00:00.000Z'

  for (const platform of ['codeforces', 'nowcoder', 'luogu', 'atcoder'] as const) {
    strictEqual(freshnessDeadline(platform, fetchedAt), expected)
  }
})

Deno.test('weekly platforms allow one day of scheduler delay before becoming stale', () => {
  const fetchedAt = '2026-07-14T00:00:00.000Z'
  const expected = '2026-07-22T00:00:00.000Z'

  for (const platform of ['xcpc_elo', 'qoj'] as const) {
    strictEqual(freshnessDeadline(platform, fetchedAt), expected)
  }
})
