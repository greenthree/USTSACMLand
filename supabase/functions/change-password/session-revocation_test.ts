import { strictEqual } from 'node:assert/strict'
import { isSessionRevocationConfirmed } from './session-revocation.ts'

Deno.test('confirms a successful explicit global sign-out', () => {
  strictEqual(isSessionRevocationConfirmed(null), true)
})

Deno.test('treats an already invalidated Auth session as revoked', () => {
  for (const status of [401, 403, 404]) {
    strictEqual(isSessionRevocationConfirmed({ status }), true)
  }
  strictEqual(isSessionRevocationConfirmed({ status: 400, code: 'session_not_found' }), true)
})

Deno.test('keeps genuine Auth failures unconfirmed', () => {
  strictEqual(
    isSessionRevocationConfirmed({ status: 429, code: 'over_request_rate_limit' }),
    false,
  )
  strictEqual(isSessionRevocationConfirmed({ status: 500, code: 'unexpected_failure' }), false)
})
