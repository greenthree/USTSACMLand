import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict'
import {
  canSelfDeleteAccount,
  DeleteAccountRequestError,
  parseDeleteAccountRequest,
} from './request.ts'

Deno.test('account deletion request preserves password and captcha whitespace', () => {
  deepStrictEqual(
    parseDeleteAccountRequest({ currentPassword: ' password ', captchaToken: ' token ' }),
    {
      currentPassword: ' password ',
      captchaToken: ' token ',
    },
  )
})

Deno.test('account deletion request rejects missing and oversized passwords', () => {
  for (const payload of [
    null,
    {},
    { currentPassword: '' },
    { currentPassword: 'password' },
    { currentPassword: 'password', captchaToken: '' },
    {
      currentPassword: 'x'.repeat(257),
      captchaToken: 'token',
    },
    { currentPassword: 'password', captchaToken: 'x'.repeat(4097) },
  ]) {
    throws(() => parseDeleteAccountRequest(payload), DeleteAccountRequestError)
  }
})

Deno.test('only ordinary member accounts may use self-service deletion', () => {
  strictEqual(canSelfDeleteAccount('member'), true)
  strictEqual(canSelfDeleteAccount('admin'), false)
  strictEqual(canSelfDeleteAccount(null), false)
})
