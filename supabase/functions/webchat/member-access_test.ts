import { strictEqual, throws } from 'node:assert/strict'
import { parseWebChatMemberRuntimeAccess } from './member-access.ts'

Deno.test('webchat member access parser maps an authorized runtime row', () => {
  const access = parseWebChatMemberRuntimeAccess([
    {
      account_eligible: true,
      access_enabled: true,
      daily_request_limit: 12,
      daily_token_limit: 50_000,
      version: 3,
    },
  ])

  strictEqual(access.accountEligible, true)
  strictEqual(access.enabled, true)
  strictEqual(access.dailyRequestLimit, 12)
  strictEqual(access.dailyTokenLimit, 50_000)
  strictEqual(access.version, 3)
})

Deno.test('webchat member access parser preserves default deny rows', () => {
  const access = parseWebChatMemberRuntimeAccess({
    account_eligible: true,
    access_enabled: false,
    daily_request_limit: 30,
    daily_token_limit: 100_000,
    version: 0,
  })
  strictEqual(access.enabled, false)
})

Deno.test('webchat member access parser rejects missing and malformed data', () => {
  for (const value of [
    null,
    [],
    {},
    {
      account_eligible: true,
      access_enabled: true,
      daily_request_limit: 0,
      daily_token_limit: 100_000,
      version: 0,
    },
  ]) {
    throws(() => parseWebChatMemberRuntimeAccess(value), Error, 'member access RPC')
  }
})
