const referralMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { rpc: referralMocks.rpc },
}))

import {
  buildReferralRegistrationUrl,
  checkReferralCodeAvailability,
  fetchOwnReferralSummary,
  normalizeReferralCode,
  referralCodeError,
} from './referrals'

describe('referral helpers', () => {
  beforeEach(() => {
    referralMocks.rpc.mockReset()
  })

  it('normalizes and validates the public code format', () => {
    expect(normalizeReferralCode(' 8a4c19f2e7b603d5 ')).toBe('8A4C19F2E7B603D5')
    expect(referralCodeError('8A4C19F2E7B603D5')).toBeNull()
    expect(referralCodeError('not-a-code')).toBe('邀请码应为 16 位字母或数字。')
    expect(referralCodeError('')).toBeNull()
  })

  it('checks availability without accepting database errors as invalid codes', async () => {
    referralMocks.rpc.mockResolvedValueOnce({
      data: [{ program_enabled: true, available: true }],
      error: null,
    })
    await expect(checkReferralCodeAvailability('8a4c19f2e7b603d5')).resolves.toEqual({
      programEnabled: true,
      available: true,
    })
    expect(referralMocks.rpc).toHaveBeenCalledWith('check_referral_code', {
      requested_code: '8A4C19F2E7B603D5',
    })

    referralMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') })
    await expect(checkReferralCodeAvailability('8A4C19F2E7B603D5')).rejects.toThrow(
      '邀请码暂时无法验证，请稍后重试。',
    )
  })

  it('reads the global state without requiring a referral code', async () => {
    referralMocks.rpc.mockResolvedValueOnce({
      data: [{ program_enabled: false, available: false }],
      error: null,
    })

    await expect(checkReferralCodeAvailability()).resolves.toEqual({
      programEnabled: false,
      available: false,
    })
    expect(referralMocks.rpc).toHaveBeenCalledWith('check_referral_code', {
      requested_code: '',
    })
  })

  it('maps the private own-summary RPC response', async () => {
    referralMocks.rpc.mockResolvedValueOnce({
      data: [
        {
          program_enabled: true,
          code: '8A4C19F2E7B603D5',
          reward_count: 2,
          remaining_rewards: 8,
          reward_tokens: 2_000_000,
          available: true,
        },
      ],
      error: null,
    })

    await expect(fetchOwnReferralSummary()).resolves.toEqual({
      programEnabled: true,
      code: '8A4C19F2E7B603D5',
      rewardCount: 2,
      remainingRewards: 8,
      rewardTokens: 2_000_000,
      available: true,
    })
  })

  it('keeps historical rewards while hiding the code when the program is paused', async () => {
    referralMocks.rpc.mockResolvedValueOnce({
      data: [
        {
          program_enabled: false,
          code: null,
          reward_count: 3,
          remaining_rewards: 7,
          reward_tokens: '3000000',
          available: false,
        },
      ],
      error: null,
    })

    await expect(fetchOwnReferralSummary()).resolves.toEqual({
      programEnabled: false,
      code: null,
      rewardCount: 3,
      remainingRewards: 7,
      rewardTokens: 3_000_000,
      available: false,
    })
  })

  it('rejects malformed structured RPC responses', async () => {
    referralMocks.rpc.mockResolvedValueOnce({
      data: [{ program_enabled: true, available: 'yes' }],
      error: null,
    })
    await expect(checkReferralCodeAvailability()).rejects.toThrow(
      '邀请码暂时无法验证，请稍后重试。',
    )
  })

  it('builds a base-path-safe shared registration URL', () => {
    expect(
      buildReferralRegistrationUrl('8a4c19f2e7b603d5', 'https://greenthree.github.io/USTSACMLand/'),
    ).toBe('https://greenthree.github.io/USTSACMLand/register?invite=8A4C19F2E7B603D5')
  })

  it('uses the configured site root instead of a trailing account route', () => {
    window.history.replaceState({}, '', '/account/')

    expect(buildReferralRegistrationUrl('8a4c19f2e7b603d5')).toBe(
      `${window.location.origin}/register?invite=8A4C19F2E7B603D5`,
    )
  })
})
