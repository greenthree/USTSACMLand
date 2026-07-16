import { strictEqual } from 'node:assert/strict'
import { shouldCheckFirecrawlCredits } from './firecrawl-monitor.ts'

Deno.test('Firecrawl credits are checked once for a scheduled QOJ batch', () => {
  strictEqual(shouldCheckFirecrawlCredits(true, 'platforms', ['xcpc_elo', 'qoj'], undefined), true)
  strictEqual(shouldCheckFirecrawlCredits(true, 'platforms', ['qoj'], 42), false)
})

Deno.test('Firecrawl credits are not checked for queue retries or manual administrators', () => {
  strictEqual(shouldCheckFirecrawlCredits(true, 'queue', ['qoj'], undefined), false)
  strictEqual(shouldCheckFirecrawlCredits(false, 'platforms', ['qoj'], undefined), false)
})

Deno.test('Firecrawl credits are not checked for batches that do not include QOJ', () => {
  strictEqual(
    shouldCheckFirecrawlCredits(true, 'platforms', ['codeforces', 'nowcoder'], undefined),
    false,
  )
})

Deno.test('all-scope scheduled batches check QOJ credits before the first page', () => {
  strictEqual(shouldCheckFirecrawlCredits(true, 'all', undefined, undefined), true)
  strictEqual(shouldCheckFirecrawlCredits(true, 'all', undefined, 12), false)
})

Deno.test('member batches check once because QOJ may appear on a later account page', () => {
  strictEqual(shouldCheckFirecrawlCredits(true, 'member', undefined, undefined), true)
  strictEqual(shouldCheckFirecrawlCredits(true, 'member', undefined, 42), false)
})
