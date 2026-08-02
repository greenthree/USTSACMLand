// deno-lint-ignore-file require-await
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  createMemberAvatarHandler,
  type MemberAvatarHandlerDependencies,
  type MemberAvatarServices,
} from './handler.ts'

const memberId = '11111111-1111-4111-8111-111111111111'
const objectKey = `member/${memberId}/22222222-2222-4222-8222-222222222222.webp`
const imageBytes = new Uint8Array([82, 73, 70, 70, 87, 69, 66, 80])

function services(overrides: Partial<MemberAvatarServices> = {}): MemberAvatarServices {
  return {
    async readVisibleAvatar() {
      return { avatarPath: objectKey, avatarUpdatedAt: '2026-08-02T00:00:00Z' }
    },
    async downloadAvatar() {
      return imageBytes.buffer
    },
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<MemberAvatarHandlerDependencies> = {},
): MemberAvatarHandlerDependencies {
  return {
    createServices: () => services(),
    async reportUnexpectedError() {},
    ...overrides,
  }
}

function request(query = `memberId=${memberId}&v=2026-08-02T00%3A00%3A00Z`): Request {
  return new Request(`https://project.supabase.co/functions/v1/member-avatar?${query}`)
}

Deno.test('member avatar returns a visible member WebP with no-store caching', async () => {
  let readMemberId = ''
  let downloadedObjectKey = ''
  const response = await createMemberAvatarHandler(
    dependencies({
      createServices: () =>
        services({
          async readVisibleAvatar(value) {
            readMemberId = value
            return { avatarPath: objectKey, avatarUpdatedAt: '2026-08-02T00:00:00Z' }
          },
          async downloadAvatar(value) {
            downloadedObjectKey = value
            return imageBytes.buffer
          },
        }),
    }),
  )(request())

  strictEqual(response.status, 200)
  strictEqual(response.headers.get('content-type'), 'image/webp')
  strictEqual(response.headers.get('cache-control'), 'no-store')
  strictEqual(response.headers.get('x-content-type-options'), 'nosniff')
  strictEqual(readMemberId, memberId)
  strictEqual(downloadedObjectKey, objectKey)
  deepStrictEqual(new Uint8Array(await response.arrayBuffer()), imageBytes)
})

Deno.test('member avatar returns 404 for hidden members and members without avatars', async () => {
  for (const visibleAvatar of [
    null,
    { avatarPath: null, avatarUpdatedAt: null },
    { avatarPath: objectKey, avatarUpdatedAt: null },
  ]) {
    let downloads = 0
    const response = await createMemberAvatarHandler(
      dependencies({
        createServices: () =>
          services({
            async readVisibleAvatar() {
              return visibleAvatar
            },
            async downloadAvatar() {
              downloads += 1
              return imageBytes.buffer
            },
          }),
      }),
    )(request())

    strictEqual(response.status, 404)
    strictEqual(response.headers.get('cache-control'), 'no-store')
    strictEqual(downloads, 0)
  }
})

Deno.test('member avatar rejects unsupported methods and invalid query input', async () => {
  let serviceCreations = 0
  const handler = createMemberAvatarHandler(
    dependencies({
      createServices() {
        serviceCreations += 1
        return services()
      },
    }),
  )

  for (const invalidRequest of [
    new Request(`https://project.supabase.co/functions/v1/member-avatar?memberId=${memberId}`, {
      method: 'POST',
    }),
    request('memberId=not-a-uuid'),
    request(`memberId=${memberId}&memberId=${memberId}`),
    request(`memberId=${memberId}&qq=123456`),
    request(`memberId=${memberId}&v=invalid%20version`),
  ]) {
    const response = await handler(invalidRequest)
    strictEqual(response.status, invalidRequest.method === 'POST' ? 405 : 400)
    strictEqual(response.headers.get('cache-control'), 'no-store')
  }
  strictEqual(serviceCreations, 0)
})

Deno.test('member avatar redacts and reports private storage failures', async () => {
  const reported: unknown[] = []
  const response = await createMemberAvatarHandler(
    dependencies({
      createServices: () =>
        services({
          async downloadAvatar() {
            throw new Error('storage failed for QQ 123456789')
          },
        }),
      async reportUnexpectedError(_request, error) {
        reported.push(error)
      },
    }),
  )(request())

  strictEqual(response.status, 503)
  strictEqual(response.headers.get('cache-control'), 'no-store')
  const body = await response.text()
  strictEqual(body.includes('123456789'), false)
  strictEqual(body.includes('storage failed'), false)
  strictEqual(reported.length, 1)
})
