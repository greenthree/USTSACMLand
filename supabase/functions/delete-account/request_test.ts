import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict'
import {
  canSelfDeleteAccount,
  DeleteAccountRequestError,
  parseDeleteAccountRequest,
} from './request.ts'

Deno.test('account deletion request preserves the password without trimming it', () => {
  deepStrictEqual(parseDeleteAccountRequest({ currentPassword: ' password ' }), {
    currentPassword: ' password ',
  })
})

Deno.test('account deletion request rejects missing and oversized passwords', () => {
  for (const payload of [
    null,
    {},
    { currentPassword: '' },
    {
      currentPassword: 'x'.repeat(257),
    },
  ]) {
    throws(() => parseDeleteAccountRequest(payload), DeleteAccountRequestError)
  }
})

Deno.test('only ordinary member accounts may use self-service deletion', () => {
  strictEqual(canSelfDeleteAccount('member'), true)
  strictEqual(canSelfDeleteAccount('admin'), false)
  strictEqual(canSelfDeleteAccount(null), false)
})
