import { assertEquals } from '@std/assert'
import {
  createAuthCaptchaConfigHandler,
  AuthCaptchaConfigServiceError,
  type AuthCaptchaConfigHandlerDependencies,
  type AuthCaptchaConfigServices,
} from './handler.ts'

const base = ['https:', '', 'example.test'].join('/')

function dependencies(
  overrides: Partial<AuthCaptchaConfigServices> = {},
): AuthCaptchaConfigHandlerDependencies {
  function createServices() {
    return {
      getUser() {
        return Promise.resolve({ id: 'admin-id' })
      },
      getAdminState() {
        return Promise.resolve({ role: 'admin', reviewStatus: 'approved' })
      },
      readConfig() {
        return Promise.resolve({ enabled: true, version: 2, updatedAt: '2026-09-08T00:00:00.000Z' })
      },
      updateConfig() {
        return Promise.resolve({
          enabled: false,
          version: 3,
          updatedAt: '2026-09-08T00:01:00.000Z',
        })
      },
    }
  }
  return {
    allowedOrigins: 'http/workspace/083c59aebcd1',
    createServices() {
      return { ...createServices(), ...overrides }
    },
  }
}

Deno.test('auth CAPTCHA config exposes only the public switch on GET', async () => {
  const handler = createAuthCaptchaConfigHandler(dependencies())
  const response = await handler(new Request(new URL('/', base), { method: 'GET' }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), {
    config: { enabled: true, version: 2, updatedAt: '2026-09-08T00:00:00.000Z' },
  })
})

Deno.test('auth CAPTCHA config requires an approved administrator for updates', async () => {
  let updated = false
  const handler = createAuthCaptchaConfigHandler(
    dependencies({
      getAdminState() {
        return Promise.resolve(null)
      },
      updateConfig() {
        updated = true
        return Promise.resolve({
          enabled: false,
          version: 3,
          updatedAt: '2026-09-08T00:01:00.000Z',
        })
      },
    }),
  )
  const response = await handler(
    new Request(new URL('/', base), {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, expectedVersion: 2, reason: 'temporary maintenance' }),
    }),
  )
  assertEquals(response.status, 403)
  assertEquals(updated, false)
})

Deno.test('auth CAPTCHA config maps management failures to a protected error', async () => {
  const handler = createAuthCaptchaConfigHandler(
    dependencies({
      updateConfig() {
        return Promise.reject(new AuthCaptchaConfigServiceError('management_unavailable'))
      },
    }),
  )
  const response = await handler(
    new Request(new URL('/', base), {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, expectedVersion: 2, reason: 'temporary maintenance' }),
    }),
  )
  assertEquals(response.status, 503)
  assertEquals((await response.json()).error.code, 'management_unavailable')
})
