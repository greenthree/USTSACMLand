import { deepStrictEqual, throws } from 'node:assert/strict'
import { ChangePasswordRequestError, parseChangePasswordRequest } from './request.ts'

Deno.test('password change request preserves password whitespace', () => {
  deepStrictEqual(
    parseChangePasswordRequest({
      currentPassword: ' old password ',
      newPassword: ' new password ',
    }),
    {
      currentPassword: ' old password ',
      newPassword: ' new password ',
    },
  )
})

Deno.test('password change request rejects invalid lengths and password reuse', () => {
  for (const payload of [
    null,
    {},
    { currentPassword: '', newPassword: 'new-password' },
    { currentPassword: 'old-password', newPassword: 'short' },
    { currentPassword: 'same-password', newPassword: 'same-password' },
    { currentPassword: 'x'.repeat(257), newPassword: 'new-password' },
    { currentPassword: 'old-password', newPassword: 'x'.repeat(257) },
  ]) {
    throws(() => parseChangePasswordRequest(payload), ChangePasswordRequestError)
  }
})
