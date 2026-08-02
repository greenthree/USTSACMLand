// deno-lint-ignore-file require-await
import { assertEquals, assertStringIncludes } from '@std/assert'
import { AvatarServiceError, createSyncAvatarHandler, type SyncAvatarServices } from './handler.ts'

const MEMBER_ID = '00000000-0000-4000-8000-000000000001'

function request(body: unknown = {}): Request {
  return new Request('https://example.test/functions/v1/sync-avatar', {
    method: 'POST',
    headers: {
      authorization: 'Bearer user-token',
      'content-type': 'application/json',
      origin: 'https://ustsacm.fun',
    },
    body: JSON.stringify(body),
  })
}

function fixture(qq: string | null = '12345678') {
  const calls: string[] = []
  const services: SyncAvatarServices = {
    async authorizeTarget(_token, requestedMemberId) {
      calls.push(`authorize:${requestedMemberId ?? 'self'}`)
      return requestedMemberId ?? MEMBER_ID
    },
    async beginSync(profileId, ownerToken) {
      calls.push('begin')
      return {
        profileId,
        qq,
        objectKey: `member/${profileId}/${ownerToken}.webp`,
        previousObjectKey: `member/${profileId}/previous.webp`,
        sourceQqSha256: qq ? 'b'.repeat(64) : null,
      }
    },
    async renewSync() {
      calls.push('renew')
      return true
    },
    async uploadObject() {
      calls.push('upload')
    },
    async removeObject(objectKey) {
      calls.push(`remove:${objectKey}`)
    },
    async completeSync() {
      calls.push('complete')
      return '2026-08-02T00:00:00Z'
    },
    async completeRemoval() {
      calls.push('complete-removal')
    },
    async failSync() {
      calls.push('fail')
    },
  }
  const handler = createSyncAvatarHandler({
    allowedOrigins: 'https://ustsacm.fun',
    createServices: () => services,
    async fetchAvatar(value) {
      calls.push(`fetch:${value}`)
      return { bytes: new Uint8Array([1]), mediaType: 'image/jpeg' }
    },
    async normalizeAvatar() {
      calls.push('normalize')
      return { bytes: new Uint8Array([2]), sha256: 'a'.repeat(64) }
    },
    async reportUnexpectedError() {
      calls.push('report')
    },
  })
  return { handler, services, calls }
}

Deno.test('synchronizes a QQ avatar without returning the QQ number', async () => {
  const { handler, calls } = fixture()
  const response = await handler(request())
  const body = await response.text()

  assertEquals(response.status, 200)
  assertEquals(JSON.parse(body), {
    avatarAvailable: true,
    updated: true,
    updatedAt: '2026-08-02T00:00:00Z',
  })
  assertEquals(body.includes('12345678'), false)
  assertEquals(calls, [
    'authorize:self',
    'begin',
    'fetch:12345678',
    'normalize',
    'renew',
    'upload',
    'complete',
    `remove:member/${MEMBER_ID}/previous.webp`,
  ])
})

Deno.test('removes the cached avatar when QQ is cleared', async () => {
  const { handler, calls } = fixture(null)
  const response = await handler(request())
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { avatarAvailable: false, updated: true })
  assertEquals(calls, [
    'authorize:self',
    'begin',
    'complete-removal',
    `remove:member/${MEMBER_ID}/previous.webp`,
  ])
})

Deno.test('preserves the old object when the upstream request fails before upload', async () => {
  const fixtureValue = fixture()
  const error = new Error('offline')
  error.name = 'AvatarSourceError'
  const handler = createSyncAvatarHandler({
    allowedOrigins: 'https://ustsacm.fun',
    createServices: () => fixtureValue.services,
    async fetchAvatar() {
      throw error
    },
    async normalizeAvatar() {
      throw new Error('unreachable')
    },
    async reportUnexpectedError() {
      fixtureValue.calls.push('report')
    },
  })

  const response = await handler(request())
  assertEquals(response.status, 502)
  assertEquals(fixtureValue.calls, ['authorize:self', 'begin', 'fail'])
  assertStringIncludes(await response.text(), 'QQ 头像暂时无法获取')
})

Deno.test('a stale completion removes only its own versioned object', async () => {
  const fixtureValue = fixture()
  fixtureValue.services.completeSync = async () => {
    fixtureValue.calls.push('complete')
    throw new Error('lease replaced')
  }

  const response = await fixtureValue.handler(request())
  assertEquals(response.status, 500)
  const removed = fixtureValue.calls.find((call) => call.startsWith('remove:'))
  assertEquals(removed?.startsWith(`remove:member/${MEMBER_ID}/`), true)
  assertEquals(removed?.endsWith('/previous.webp'), false)
  assertEquals(fixtureValue.calls.includes('fail'), true)
})

Deno.test('returns a forbidden response without starting a synchronization', async () => {
  const fixtureValue = fixture()
  fixtureValue.services.authorizeTarget = async () => {
    throw new AvatarServiceError('forbidden')
  }
  const response = await fixtureValue.handler(request({ memberId: MEMBER_ID }))
  assertEquals(response.status, 403)
  assertStringIncludes(await response.text(), '无权同步该成员头像')
  assertEquals(fixtureValue.calls, [])
})

Deno.test('rejects unlisted browser origins', async () => {
  const { handler, calls } = fixture()
  const response = await handler(
    new Request('https://example.test/functions/v1/sync-avatar', {
      method: 'POST',
      headers: { authorization: 'Bearer token', origin: 'https://evil.example' },
    }),
  )
  assertEquals(response.status, 403)
  assertEquals(calls, [])
})
