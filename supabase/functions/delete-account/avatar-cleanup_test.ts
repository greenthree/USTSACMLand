// deno-lint-ignore-file require-await
import { assertEquals, assertRejects } from '@std/assert'
import {
  deleteAuthUserWithAvatarCleanup,
  type AvatarCleanupDependencies,
} from './avatar-cleanup.ts'

function dependencies(overrides: Partial<AvatarCleanupDependencies> = {}) {
  const calls: string[] = []
  let deleteAttempt = 0
  const value: AvatarCleanupDependencies = {
    async deleteAuthUser() {
      deleteAttempt += 1
      calls.push(`delete:${deleteAttempt}`)
      return deleteAttempt === 2
    },
    async prepareAvatarDeletion() {
      calls.push('prepare')
      return { ready: true }
    },
    async removeAvatarObjects(userId) {
      calls.push(`remove:${userId}`)
    },
    async cancelAvatarDeletion() {
      calls.push('cancel')
    },
    ...overrides,
  }
  return { value, calls }
}

Deno.test('removes the avatar only after the fenced deletion first declines', async () => {
  const fixture = dependencies()
  assertEquals(await deleteAuthUserWithAvatarCleanup(fixture.value, 'member-id'), true)
  assertEquals(fixture.calls, ['delete:1', 'prepare', 'remove:member-id', 'delete:2'])
})

Deno.test('does not touch the avatar when Auth deletion succeeds immediately', async () => {
  const fixture = dependencies({
    async deleteAuthUser() {
      return true
    },
  })
  assertEquals(await deleteAuthUserWithAvatarCleanup(fixture.value, 'member-id'), true)
  assertEquals(fixture.calls, [])
})

Deno.test('leaves the avatar intact while another cleanup or sync is active', async () => {
  const fixture = dependencies({
    async prepareAvatarDeletion() {
      fixture.calls.push('prepare')
      return { ready: false }
    },
  })
  assertEquals(await deleteAuthUserWithAvatarCleanup(fixture.value, 'member-id'), false)
  assertEquals(fixture.calls, ['delete:1', 'prepare'])
})

Deno.test(
  'unfreezes avatar synchronization when the second deletion attempt declines',
  async () => {
    const fixture = dependencies({
      async deleteAuthUser() {
        fixture.calls.push('delete')
        return false
      },
    })
    assertEquals(await deleteAuthUserWithAvatarCleanup(fixture.value, 'member-id'), false)
    assertEquals(fixture.calls, ['delete', 'prepare', 'remove:member-id', 'delete', 'cancel'])
  },
)

Deno.test('unfreezes after Storage removal fails and preserves that failure', async () => {
  const fixture = dependencies({
    async removeAvatarObjects() {
      fixture.calls.push('remove')
      throw new Error('storage offline')
    },
  })
  await assertRejects(
    () => deleteAuthUserWithAvatarCleanup(fixture.value, 'member-id'),
    Error,
    'storage offline',
  )
  assertEquals(fixture.calls, ['delete:1', 'prepare', 'remove', 'cancel'])
})
