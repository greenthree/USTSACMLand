import { strictEqual } from 'node:assert/strict'
import { canRequestSync, SYNC_TRIGGER_TYPES } from './access.ts'

Deno.test('ordinary members cannot request any synchronization trigger', () => {
  for (const triggerType of SYNC_TRIGGER_TYPES) {
    strictEqual(canRequestSync({ serviceRole: false, admin: false }, triggerType), false)
  }
})

Deno.test('administrators can request review and manual synchronization triggers', () => {
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
