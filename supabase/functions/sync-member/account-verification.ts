import {
  type AdapterErrorCode,
  type AdapterFailure,
  type AdapterResult,
  failure,
  type PlatformId,
} from '../_shared/adapters/types.ts'
import type { SyncTriggerType } from './access.ts'

export type PlatformAccountStatus = 'pending' | 'verified' | 'invalid' | 'disabled'

export interface VerifiablePlatformAccount {
  platform: PlatformId
  external_id: string
  status: PlatformAccountStatus
}

export interface PlatformAccountVerificationUpdate {
  external_id?: string
  status: Exclude<PlatformAccountStatus, 'disabled'>
  verification_error_code: AdapterErrorCode | null
  verification_error_message: string | null
}

const IDENTITY_ERROR_CODES = new Set(['invalid_account', 'not_found'])

export function duplicatePlatformAccountFailure(
  platform: PlatformId,
  canonicalAccountId: string,
): AdapterFailure {
  return failure(
    platform,
    canonicalAccountId,
    'invalid_account',
    'The canonical platform account is already linked to another member',
    false,
  )
}

export function isPlatformAccountEligible(
  account: VerifiablePlatformAccount,
  triggerType: SyncTriggerType,
): boolean {
  if (account.status === 'verified') return true
  if (account.status === 'disabled') return false
  if (account.platform === 'xcpc_elo') return true
  return triggerType === 'account_changed'
}

export function buildPlatformAccountVerificationUpdate(
  account: VerifiablePlatformAccount,
  result: AdapterResult,
  triggerType: SyncTriggerType,
): PlatformAccountVerificationUpdate | null {
  if (account.status === 'disabled') return null

  const resolvesBinding =
    account.platform === 'xcpc_elo' ||
    (triggerType === 'account_changed' && account.status !== 'verified')

  if (!resolvesBinding) return null

  if (result.ok) {
    return {
      external_id: result.accountId,
      status: 'verified',
      verification_error_code: null,
      verification_error_message: null,
    }
  }

  const identityFailure = IDENTITY_ERROR_CODES.has(result.error.code)
  if (account.status === 'verified' && !identityFailure) return null

  return {
    status: identityFailure ? 'invalid' : account.status,
    verification_error_code: result.error.code,
    verification_error_message: result.error.message.slice(0, 2_000),
  }
}
