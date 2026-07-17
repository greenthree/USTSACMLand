import { deepStrictEqual, equal } from 'node:assert/strict'
import { corsHeaders, jsonResponse, resolveCorsOrigin } from './cors.ts'

Deno.test('CORS defaults to a wildcard when no allowlist is configured', () => {
  equal(resolveCorsOrigin('https://example.com', ''), '*')
  equal(corsHeaders(undefined, '')['access-control-allow-origin'], '*')
})

Deno.test('CORS accepts exact origins from a comma-separated allowlist', () => {
  const configured =
    'http://localhost:5173, http://127.0.0.1:5173/, https://greenthree.github.io/USTSACMLand/'
  equal(resolveCorsOrigin('http://127.0.0.1:5173', configured), 'http://127.0.0.1:5173')
  equal(
    resolveCorsOrigin('https://greenthree.github.io', configured),
    'https://greenthree.github.io',
  )
  equal(resolveCorsOrigin('https://attacker.example', configured), null)
})

Deno.test('CORS response headers vary by an approved request origin', () => {
  const request = new Request('https://project.supabase.co/functions/v1/sync-member', {
    headers: { origin: 'https://greenthree.github.io' },
  })
  deepStrictEqual(corsHeaders(request, 'http://localhost:5173,https://greenthree.github.io'), {
    'access-control-allow-origin': 'https://greenthree.github.io',
    vary: 'Origin',
    'access-control-allow-headers':
      'authorization, apikey, content-type, x-client-info, x-request-id',
    'access-control-allow-methods': 'POST, OPTIONS',
  })
})

Deno.test('CORS does not authorize a hostile preflight origin', () => {
  const request = new Request('https://project.supabase.co/functions/v1/sync-member', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://attacker.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  })
  const headers = corsHeaders(request, 'https://greenthree.github.io')

  equal(headers['access-control-allow-origin'], undefined)
  equal(headers['access-control-allow-methods'], 'POST, OPTIONS')
})

Deno.test('JSON responses preserve an explicit Retry-After header', () => {
  const response = jsonResponse({ retryAfterSeconds: 17 }, 429, undefined, {
    'retry-after': '17',
  })

  equal(response.status, 429)
  equal(response.headers.get('retry-after'), '17')
  equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
})
