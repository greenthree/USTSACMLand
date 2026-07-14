import { strictEqual } from 'node:assert/strict'
import {
  canRequestSync,
  isRegistrationSyncWindowOpen,
  REGISTRATION_SYNC_WINDOW_MS,
  SYNC_TRIGGER_TYPES,
} from './access.ts'

Deno.test('ordinary members can only request XCPC ELO registration synchronization', () => {
  for (const triggerType of SYNC_TRIGGER_TYPES) {
    const allowed = triggerType === 'registration'
    strictEqual(
      canRequestSync({ serviceRole: false, admin: false }, triggerType, ['xcpc_elo']),
      allowed,
    )
  }
  strictEqual(canRequestSync({ serviceRole: false, admin: false }, 'registration'), false)
  strictEqual(
    canRequestSync({ serviceRole: false, admin: false }, 'registration', ['codeforces']),
    false,
  )
  strictEqual(
    canRequestSync({ serviceRole: false, admin: false }, 'registration', [
      'xcpc_elo',
      'codeforces',
    ]),
    false,
  )
})

Deno.test('administrators can request registration and manual synchronization triggers', () => {
  for (const triggerType of ['manual', 'registration', 'account_changed', 'retry'] as const) {
    strictEqual(canRequestSync({ serviceRole: false, admin: true }, triggerType), true)
  }
  strictEqual(canRequestSync({ serviceRole: false, admin: true }, 'scheduled'), false)
})

Deno.test('service role can request scheduled and administrative synchronization', () => {
  for (const triggerType of SYNC_TRIGGER_TYPES) {
    strictEqual(canRequestSync({ serviceRole: true, admin: true }, triggerType), true)
  }
})

Deno.test('ordinary registration synchronization is limited to a short signup window', () => {
  const now = Date.parse('2026-07-14T08:00:00.000Z')
  strictEqual(isRegistrationSyncWindowOpen('2026-07-14T07:59:00.000Z', now), true)
  strictEqual(
    isRegistrationSyncWindowOpen(
      new Date(now - REGISTRATION_SYNC_WINDOW_MS - 1).toISOString(),
      now,
    ),
    false,
  )
  strictEqual(isRegistrationSyncWindowOpen('not-a-date', now), false)
  strictEqual(isRegistrationSyncWindowOpen(null, now), false)
})
