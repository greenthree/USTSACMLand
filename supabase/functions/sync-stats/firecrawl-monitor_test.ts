import { strictEqual } from 'node:assert/strict'
import { shouldCheckFirecrawlCredits } from './firecrawl-monitor.ts'

Deno.test('Firecrawl credits are checked once for a scheduled QOJ batch', () => {
  strictEqual(shouldCheckFirecrawlCredits(true, 'platforms', [{ platform: 'qoj' }]), true)
})

Deno.test('Firecrawl credits are not checked for queue retries or manual administrators', () => {
  strictEqual(shouldCheckFirecrawlCredits(true, 'queue', [{ platform: 'qoj' }]), false)
  strictEqual(shouldCheckFirecrawlCredits(false, 'platforms', [{ platform: 'qoj' }]), false)
})

Deno.test('Firecrawl credits are not checked for batches that do not include QOJ', () => {
  strictEqual(
    shouldCheckFirecrawlCredits(true, 'platforms', [
      { platform: 'codeforces' },
      { platform: 'nowcoder' },
    ]),
    false,
  )
})
