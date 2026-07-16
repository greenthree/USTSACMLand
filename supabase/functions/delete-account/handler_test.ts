// deno-lint-ignore-file require-await
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { createDeleteAccountHandler, type DeleteAccountServices } from './handler.ts'

const userId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown, authorization = 'Bearer member-token'): Request {
  return new Request('https://example.test/functions/v1/delete-account', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function services(overrides: Partial<DeleteAccountServices> = {}): DeleteAccountServices {
  return {
    async getUser() {
      return { id: userId, email: 'member@example.test' }
    },
    async getProfileRole() {
      return 'member'
    },
    async verifyPassword() {
      return userId
    },
    async countActiveSyncJobs() {
      return 0
    },
    async deleteUserWithRecoveryFloor() {
      return 'deleted'
    },
    ...overrides,
  }
}

function handler(
  serviceOverrides: Partial<DeleteAccountServices> = {},
  unexpectedErrors: unknown[] = [],
) {
  return createDeleteAccountHandler({
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
  'account deletion handler rejects methods, missing tokens, and malformed bodies early',
  async () => {
    let createCount = 0
    const handle = createDeleteAccountHandler({
      createServices() {
        createCount += 1
        return services()
      },
      async reportUnexpectedError() {},
    })

    const methodResponse = await handle(
      new Request('https://example.test/functions/v1/delete-account', {
        method: 'GET',
      }),
    )
    strictEqual(methodResponse.status, 405)
    strictEqual(
      await handle(request({ currentPassword: 'password' }, '')).then((r) => r.status),
      401,
    )

    const invalidJson = await handle(
      new Request('https://example.test/functions/v1/delete-account', {
        method: 'POST',
        headers: {
          authorization: 'Bearer member-token',
          'content-type': 'application/json',
        },
        body: '{',
      }),
    )
    strictEqual(invalidJson.status, 400)
    strictEqual(await handle(request({ currentPassword: '' })).then((r) => r.status), 400)
    strictEqual(createCount, 0)
  },
)

Deno.test(
  'account deletion handler rejects invalid sessions and passwordless accounts',
  async () => {
    let profileCount = 0
    const noSession = await handler({
      async getUser() {
        return null
      },
      async getProfileRole() {
        profileCount += 1
        return 'member'
      },
    })(request({ currentPassword: 'password' }))
    strictEqual(noSession.status, 401)

    const noEmail = await handler({
      async getUser() {
        return { id: userId, email: null }
      },
      async getProfileRole() {
        profileCount += 1
        return 'member'
      },
    })(request({ currentPassword: 'password' }))
    strictEqual(noEmail.status, 409)
    strictEqual(profileCount, 0)
  },
)

Deno.test(
  'account deletion handler rejects missing profiles and administrators before password verification',
  async () => {
    let verifyCount = 0
    let floorCount = 0
    let deletionCount = 0
    const protectedServices: Partial<DeleteAccountServices> = {
      async verifyPassword() {
        verifyCount += 1
        return userId
      },
      async deleteUserWithRecoveryFloor() {
        floorCount += 1
        deletionCount += 1
        return 'deleted'
      },
    }

    const missingProfile = await handler({
      ...protectedServices,
      async getProfileRole() {
        return null
      },
    })(request({ currentPassword: 'password' }))
    strictEqual(missingProfile.status, 404)

    const administrator = await handler({
      ...protectedServices,
      async getProfileRole() {
        return 'admin'
      },
    })(request({ currentPassword: 'password' }))
    strictEqual(administrator.status, 403)
    strictEqual(verifyCount, 0)
    strictEqual(floorCount, 0)
    strictEqual(deletionCount, 0)
  },
)

Deno.test(
  'account deletion handler binds password verification to the bearer-token user',
  async () => {
    let floorCount = 0
    let deletionCount = 0
    const response = await handler({
      async verifyPassword(email, password) {
        strictEqual(email, 'member@example.test')
        strictEqual(password, 'password')
        return '22222222-2222-4222-8222-222222222222'
      },
      async deleteUserWithRecoveryFloor() {
        floorCount += 1
        deletionCount += 1
        return 'deleted'
      },
    })(request({ currentPassword: 'password', userId: 'attacker-selected-id' }))

    strictEqual(response.status, 401)
    strictEqual(floorCount, 0)
    strictEqual(deletionCount, 0)
  },
)

Deno.test(
  'account deletion handler rejects active synchronization before safety recording',
  async () => {
    let floorCount = 0
    let deletionCount = 0
    const response = await handler({
      async countActiveSyncJobs(targetUserId) {
        strictEqual(targetUserId, userId)
        return 1
      },
      async deleteUserWithRecoveryFloor() {
        floorCount += 1
        deletionCount += 1
        return 'deleted'
      },
    })(request({ currentPassword: 'password' }))

    strictEqual(response.status, 409)
    strictEqual(floorCount, 0)
    strictEqual(deletionCount, 0)
  },
)

Deno.test(
  'account deletion handler fails closed when the safe deletion reports recovery unavailable',
  async () => {
    let safeDeletionCount = 0
    const response = await handler({
      async deleteUserWithRecoveryFloor(targetUserId) {
        strictEqual(targetUserId, userId)
        safeDeletionCount += 1
        return 'recovery_unavailable'
      },
    })(request({ currentPassword: 'password' }))

    strictEqual(response.status, 503)
    deepStrictEqual(await responseBody(response), {
      error: 'Account deletion safety record is unavailable; no account data was deleted',
    })
    strictEqual(safeDeletionCount, 1)
  },
)

Deno.test('account deletion handler safely deletes only the bearer-token user', async () => {
  const calls: unknown[] = []
  const response = await handler({
    async deleteUserWithRecoveryFloor(targetUserId) {
      calls.push({ safeDelete: targetUserId })
      return 'deleted'
    },
  })(request({ currentPassword: 'password', userId: 'attacker-selected-id' }))

  strictEqual(response.status, 200)
  deepStrictEqual(await responseBody(response), { deleted: true })
  deepStrictEqual(calls, [{ safeDelete: userId }])
})

Deno.test('account deletion handler does not report success when Auth deletion fails', async () => {
  let safeDeletionCount = 0
  const response = await handler({
    async deleteUserWithRecoveryFloor() {
      safeDeletionCount += 1
      return 'deletion_failed'
    },
  })(request({ currentPassword: 'password' }))

  strictEqual(response.status, 409)
  strictEqual(safeDeletionCount, 1)
  deepStrictEqual(await responseBody(response), {
    error: 'Account deletion could not complete; retry after active work finishes',
  })
})

Deno.test(
  'account deletion handler reports unexpected profile, synchronization, and deletion failures',
  async () => {
    for (const override of [
      {
        async getProfileRole() {
          throw new Error('profile transport detail')
        },
      },
      {
        async countActiveSyncJobs() {
          throw new Error('job transport detail')
        },
      },
      {
        async deleteUserWithRecoveryFloor() {
          throw new Error('Auth transport detail')
        },
      },
      {
        async deleteUserWithRecoveryFloor() {
          return 'unsupported' as never
        },
      },
    ] satisfies Array<Partial<DeleteAccountServices>>) {
      const errors: unknown[] = []
      const response = await handler(override, errors)(request({ currentPassword: 'password' }))
      strictEqual(response.status, 500)
      deepStrictEqual(await responseBody(response), {
        error: 'Account deletion is temporarily unavailable; please retry later',
      })
      strictEqual(errors.length, 1)
    }
  },
)
