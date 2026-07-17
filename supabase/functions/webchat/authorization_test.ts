import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict'
import { resolveAuthenticatedUser } from './authorization.ts'

Deno.test('webchat authorization returns only verified user identity', () => {
  deepStrictEqual(
    resolveAuthenticatedUser({ user: { id: '11111111-1111-4111-8111-111111111111' } }, null),
    { id: '11111111-1111-4111-8111-111111111111' },
  )
})

Deno.test('webchat authorization distinguishes invalid sessions from Auth outages', () => {
  for (const status of [400, 401, 403]) {
    strictEqual(resolveAuthenticatedUser({ user: null }, { status }), null)
  }
  strictEqual(resolveAuthenticatedUser({ user: null }, null), null)
  throws(() => resolveAuthenticatedUser({ user: null }, { status: 500 }), /Auth lookup failed/)
  throws(() => resolveAuthenticatedUser({ user: null }, {}), /Auth lookup failed/)
})
