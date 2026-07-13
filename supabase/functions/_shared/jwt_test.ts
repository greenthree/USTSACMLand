import { deepStrictEqual } from 'node:assert/strict'
import { gatewayVerifiedJwtRole } from './jwt.ts'

function testToken(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${encoded}.signature`
}

Deno.test('gateway verified JWT role parser reads service and user roles', () => {
  deepStrictEqual(gatewayVerifiedJwtRole(testToken({ role: 'service_role' })), 'service_role')
  deepStrictEqual(gatewayVerifiedJwtRole(testToken({ role: 'authenticated' })), 'authenticated')
})

Deno.test('gateway verified JWT role parser rejects malformed payloads', () => {
  deepStrictEqual(gatewayVerifiedJwtRole('not-a-jwt'), null)
  deepStrictEqual(gatewayVerifiedJwtRole('a.%%%invalid%%%.c'), null)
  deepStrictEqual(gatewayVerifiedJwtRole(testToken({ role: 123 })), null)
})
