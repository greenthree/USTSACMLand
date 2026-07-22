import { supabase } from './supabase'

export const referralCodeLength = 16
export const referralRewardTokens = 1_000_000
export const referralRewardLimit = 10

export interface ReferralProgramCheck {
  programEnabled: boolean
  available: boolean
}

export interface ReferralSummary {
  programEnabled: boolean
  code: string | null
  rewardCount: number
  remainingRewards: number
  rewardTokens: number
  available: boolean
}

interface ReferralProgramCheckRow {
  program_enabled: boolean
  available: boolean
}

interface ReferralSummaryRow {
  program_enabled: boolean
  code: string | null
  reward_count: number | string
  remaining_rewards: number | string
  reward_tokens: number | string
  available: boolean
}

export function normalizeReferralCode(value: string): string {
  return value.trim().toLocaleUpperCase('en-US')
}

export function referralCodeError(value: string): string | null {
  const normalized = normalizeReferralCode(value)
  if (!normalized) return null
  return /^[A-F0-9]{16}$/.test(normalized) ? null : '邀请码应为 16 位字母或数字。'
}

function parseNonNegativeInteger(value: number | string): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function checkReferralCodeAvailability(code = ''): Promise<ReferralProgramCheck> {
  const normalized = normalizeReferralCode(code)
  if (!supabase) {
    return {
      programEnabled: true,
      available: !normalized || referralCodeError(normalized) === null,
    }
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as (
    functionName: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpc('check_referral_code', {
    requested_code: normalized,
  })
  if (error) throw new Error('邀请码暂时无法验证，请稍后重试。')

  const row = (Array.isArray(data) ? data[0] : null) as ReferralProgramCheckRow | null
  if (!row || typeof row.program_enabled !== 'boolean' || typeof row.available !== 'boolean') {
    throw new Error('邀请码暂时无法验证，请稍后重试。')
  }

  return {
    programEnabled: row.program_enabled,
    available: row.available,
  }
}

export async function fetchOwnReferralSummary(): Promise<ReferralSummary> {
  if (!supabase) {
    return {
      programEnabled: true,
      code: '8A4C19F2E7B603D5',
      rewardCount: 2,
      remainingRewards: 8,
      rewardTokens: 2_000_000,
      available: true,
    }
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as (
    functionName: string,
  ) => Promise<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpc('read_own_referral_summary')
  const row = (Array.isArray(data) ? data[0] : null) as ReferralSummaryRow | null
  const rewardCount = row ? parseNonNegativeInteger(row.reward_count) : null
  const remainingRewards = row ? parseNonNegativeInteger(row.remaining_rewards) : null
  const rewardTokens = row ? parseNonNegativeInteger(row.reward_tokens) : null
  const validCode = row?.code === null || /^[A-F0-9]{16}$/.test(row?.code ?? '')
  if (
    error ||
    !row ||
    typeof row.program_enabled !== 'boolean' ||
    typeof row.available !== 'boolean' ||
    !validCode ||
    (row.program_enabled && row.code === null) ||
    rewardCount === null ||
    remainingRewards === null ||
    rewardTokens === null
  ) {
    throw new Error('推荐计划信息读取失败，请稍后重试。')
  }

  return {
    programEnabled: row.program_enabled,
    code: row.code,
    rewardCount,
    remainingRewards,
    rewardTokens,
    available: row.available,
  }
}

export function buildReferralRegistrationUrl(
  code: string,
  baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI).toString(),
): string {
  const url = new URL('register', baseUrl)
  url.searchParams.set('invite', normalizeReferralCode(code))
  return url.toString()
}
