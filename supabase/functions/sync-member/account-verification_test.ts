import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { failure, success } from '../_shared/adapters/types.ts'
import {
  buildPlatformAccountVerificationUpdate,
  duplicatePlatformAccountFailure,
  isPlatformAccountEligible,
  type VerifiablePlatformAccount,
} from './account-verification.ts'

const pendingCodeforces: VerifiablePlatformAccount = {
  platform: 'codeforces',
  external_id: 'tourist',
  status: 'pending',
}

Deno.test('pending platform accounts are eligible only for account-change verification', () => {
  strictEqual(isPlatformAccountEligible(pendingCodeforces, 'scheduled'), false)
  strictEqual(isPlatformAccountEligible(pendingCodeforces, 'manual'), false)
  strictEqual(isPlatformAccountEligible(pendingCodeforces, 'account_changed'), true)
})

Deno.test('verified and XCPC ELO accounts retain their normal synchronization eligibility', () => {
  strictEqual(
    isPlatformAccountEligible({ ...pendingCodeforces, status: 'verified' }, 'scheduled'),
    true,
  )
  strictEqual(
    isPlatformAccountEligible(
      { platform: 'xcpc_elo', external_id: 'member-name', status: 'invalid' },
      'registration',
    ),
    true,
  )
  strictEqual(
    isPlatformAccountEligible({ ...pendingCodeforces, status: 'disabled' }, 'account_changed'),
    false,
  )
})

Deno.test('successful verification returns the canonical upstream account ID', () => {
  const result = success(
    'codeforces',
    'Tourist',
    { currentRating: 3800, maxRating: 4009, solvedCount: 3000 },
    { sourceUpdatedAt: null, sourceVersion: 'fixture' },
  )

  deepStrictEqual(
    buildPlatformAccountVerificationUpdate(pendingCodeforces, result, 'account_changed'),
    {
      external_id: 'Tourist',
      status: 'verified',
      verification_error_code: null,
      verification_error_message: null,
    },
  )
})

Deno.test('identity failures mark a pending binding invalid', () => {
  const result = failure('codeforces', 'missing', 'not_found', 'User not found', false)
  deepStrictEqual(
    buildPlatformAccountVerificationUpdate(pendingCodeforces, result, 'account_changed'),
    {
      status: 'invalid',
      verification_error_code: 'not_found',
      verification_error_message: 'User not found',
    },
  )
})

Deno.test('upstream failures preserve pending state for a later verification attempt', () => {
  const result = failure('codeforces', 'tourist', 'rate_limited', 'Try later', true)
  deepStrictEqual(
    buildPlatformAccountVerificationUpdate(pendingCodeforces, result, 'account_changed'),
    {
      status: 'pending',
      verification_error_code: 'rate_limited',
      verification_error_message: 'Try later',
    },
  )
})

Deno.test('routine synchronization does not rewrite non-XCPC verification state', () => {
  const verified = { ...pendingCodeforces, status: 'verified' as const }
  const result = success(
    'codeforces',
    'Tourist',
    { currentRating: 3800, maxRating: 4009, solvedCount: 3000 },
    { sourceUpdatedAt: null, sourceVersion: 'fixture' },
  )
  strictEqual(buildPlatformAccountVerificationUpdate(verified, result, 'scheduled'), null)
})

Deno.test('XCPC identity disappearance invalidates an existing automatic match', () => {
  const account: VerifiablePlatformAccount = {
    platform: 'xcpc_elo',
    external_id: 'xcpc_existing',
    status: 'verified',
  }
  const result = failure('xcpc_elo', 'xcpc_existing', 'not_found', 'No unique match', false)
  deepStrictEqual(buildPlatformAccountVerificationUpdate(account, result, 'scheduled'), {
    status: 'invalid',
    verification_error_code: 'not_found',
    verification_error_message: 'No unique match',
  })
})

Deno.test('canonical account conflicts do not disclose the existing owner', () => {
  const result = duplicatePlatformAccountFailure('codeforces', 'Tourist')
  strictEqual(result.ok, false)
  if (result.ok) return
  strictEqual(result.error.code, 'invalid_account')
  strictEqual(result.error.retryable, false)
  strictEqual(result.error.message.includes('profile'), false)
  strictEqual(result.error.message.includes('email'), false)
  strictEqual(result.error.message.includes('name'), false)
})
