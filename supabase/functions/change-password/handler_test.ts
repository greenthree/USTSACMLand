// deno-lint-ignore-file require-await
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { createChangePasswordHandler, type ChangePasswordServices } from './handler.ts'

const userId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown, authorization = 'Bearer member-token'): Request {
  return new Request('https://example.test/functions/v1/change-password', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function services(overrides: Partial<ChangePasswordServices> = {}): ChangePasswordServices {
  return {
    async getUser() {
      return { id: userId, email: 'member@example.test' }
    },
    async verifyPassword() {
      return userId
    },
    async updatePassword() {
      return true
    },
    async revokeSessions() {
      return true
    },
    ...overrides,
  }
}

function handler(
  serviceOverrides: Partial<ChangePasswordServices> = {},
  unexpectedErrors: unknown[] = [],
) {
  return createChangePasswordHandler({
    createServices: () => services(serviceOverrides),
    async reportUnexpectedError(_request, error) {
      unexpectedErrors.push(error)
    },
  })
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

Deno.test(
  'password change handler rejects unsupported methods and missing bearer tokens',
  async () => {
    let createCount = 0
    const handle = createChangePasswordHandler({
      createServices() {
        createCount += 1
        return services()
      },
      async reportUnexpectedError() {},
    })

    const methodResponse = await handle(
      new Request('https://example.test/functions/v1/change-password', { method: 'GET' }),
    )
    strictEqual(methodResponse.status, 405)

    const tokenResponse = await handle(
      request({ currentPassword: 'old-password', newPassword: 'new-password' }, ''),
    )
    strictEqual(tokenResponse.status, 401)
    strictEqual(createCount, 0)
  },
)

Deno.test(
  'password change handler rejects invalid JSON and invalid fields before Auth access',
  async () => {
    let createCount = 0
    const handle = createChangePasswordHandler({
      createServices() {
        createCount += 1
        return services()
      },
      async reportUnexpectedError() {},
    })
    const invalidJson = await handle(
      new Request('https://example.test/functions/v1/change-password', {
        method: 'POST',
        headers: { authorization: 'Bearer member-token', 'content-type': 'application/json' },
        body: '{',
      }),
    )
    strictEqual(invalidJson.status, 400)

    const invalidFields = await handle(
      request({ currentPassword: 'old-password', newPassword: 'short' }),
    )
    strictEqual(invalidFields.status, 400)
    strictEqual(createCount, 0)
  },
)

Deno.test(
  'password change handler rejects invalid sessions and accounts without email',
  async () => {
    let verifyCount = 0
    let updateCount = 0
    const noSession = await handler({
      async getUser() {
        return null
      },
      async verifyPassword() {
        verifyCount += 1
        return userId
      },
      async updatePassword() {
        updateCount += 1
        return true
      },
    })(request({ currentPassword: 'old-password', newPassword: 'new-password' }))
    strictEqual(noSession.status, 401)

    const noEmail = await handler({
      async getUser() {
        return { id: userId, email: null }
      },
    })(request({ currentPassword: 'old-password', newPassword: 'new-password' }))
    strictEqual(noEmail.status, 409)
    strictEqual(verifyCount, 0)
    strictEqual(updateCount, 0)
  },
)

Deno.test(
  'password change handler binds password verification to the bearer-token user',
  async () => {
    let updateCount = 0
    const response = await handler({
      async verifyPassword(email, password) {
        strictEqual(email, 'member@example.test')
        strictEqual(password, 'old-password')
        return '22222222-2222-4222-8222-222222222222'
      },
      async updatePassword() {
        updateCount += 1
        return true
      },
    })(
      request({
        currentPassword: 'old-password',
        newPassword: 'new-password',
        userId: 'attacker-selected-id',
      }),
    )

    strictEqual(response.status, 401)
    strictEqual(updateCount, 0)
  },
)

Deno.test('password change handler updates only the bearer-token user', async () => {
  const updates: unknown[] = []
  const revocations: string[] = []
  const response = await handler({
    async updatePassword(targetUserId, password) {
      updates.push({ targetUserId, password })
      return true
    },
    async revokeSessions(token) {
      revocations.push(token)
      return true
    },
  })(
    request({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      userId: 'attacker-selected-id',
    }),
  )

  strictEqual(response.status, 200)
  deepStrictEqual(await responseBody(response), { updated: true, sessionsRevoked: true })
  deepStrictEqual(updates, [{ targetUserId: userId, password: 'new-password' }])
  deepStrictEqual(revocations, ['member-token'])
})

Deno.test('password change handler fails closed when Auth rejects the update', async () => {
  const response = await handler({
    async updatePassword() {
      return false
    },
  })(request({ currentPassword: 'old-password', newPassword: 'new-password' }))

  strictEqual(response.status, 409)
  deepStrictEqual(await responseBody(response), { error: 'Password could not be updated' })
})

Deno.test(
  'password change handler reports partial success when session revocation fails',
  async () => {
    for (const revokeSessions of [
      async () => false,
      async () => {
        throw new Error('provider revocation detail')
      },
    ]) {
      const errors: unknown[] = []
      const response = await handler(
        { revokeSessions },
        errors,
      )(request({ currentPassword: 'old-password', newPassword: 'new-password' }))

      strictEqual(response.status, 200)
      deepStrictEqual(await responseBody(response), { updated: true, sessionsRevoked: false })
      strictEqual(errors.length, 1)
    }
  },
)

Deno.test(
  'password change handler reports unexpected service failures without exposing details',
  async () => {
    const errors: unknown[] = []
    const response = await handler(
      {
        async getUser() {
          throw new Error('sensitive provider detail')
        },
      },
      errors,
    )(request({ currentPassword: 'old-password', newPassword: 'new-password' }))

    strictEqual(response.status, 500)
    deepStrictEqual(await responseBody(response), {
      error: 'Password change is temporarily unavailable; please retry later',
    })
    strictEqual(errors.length, 1)
  },
)
