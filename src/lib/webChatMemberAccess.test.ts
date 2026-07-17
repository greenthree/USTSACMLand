const accessMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc: accessMocks.rpc } }))

import {
  fetchAdminWebChatMemberAccess,
  fetchOwnWebChatUsage,
  mapWebChatMemberAccess,
  mapWebChatMemberUsage,
  updateAdminWebChatMemberAccess,
  WebChatMemberAccessConflictError,
} from './webChatMemberAccess'

const accessRow = {
  access_enabled: true,
  daily_request_limit: 12,
  daily_token_limit: 50_000,
  version: 3,
  updated_at: '2026-07-17T08:00:00Z',
}

const usageRow = {
  access_enabled: true,
  model: 'gpt-5.6-sol',
  usage_date: '2026-07-17',
  daily_request_limit: 12,
  request_count: 4,
  remaining_requests: 8,
  daily_token_limit: 50_000,
  settled_tokens: 9_000,
  reserved_tokens: 3_000,
  remaining_tokens: 38_000,
  reset_at: '2026-07-17T16:00:00Z',
}

describe('WebChat member access adapters', () => {
  beforeEach(() => accessMocks.rpc.mockReset())

  it('maps a private administrator configuration without adding profile data', () => {
    expect(mapWebChatMemberAccess([accessRow])).toEqual({
      enabled: true,
      dailyRequestLimit: 12,
      dailyTokenLimit: 50_000,
      version: 3,
      updatedAt: '2026-07-17T08:00:00Z',
    })
  })

  it('reads and updates the target member with a trimmed reason and expected version', async () => {
    accessMocks.rpc
      .mockResolvedValueOnce({ data: [accessRow], error: null })
      .mockResolvedValueOnce({ data: [{ ...accessRow, version: 4 }], error: null })

    await expect(fetchAdminWebChatMemberAccess('member-1')).resolves.toMatchObject({ version: 3 })
    await expect(
      updateAdminWebChatMemberAccess({
        memberId: 'member-1',
        enabled: true,
        dailyRequestLimit: 12,
        dailyTokenLimit: 50_000,
        expectedVersion: 3,
        reason: '  开放首批试运行  ',
      }),
    ).resolves.toMatchObject({ version: 4 })

    expect(accessMocks.rpc).toHaveBeenNthCalledWith(1, 'admin_get_webchat_member_access', {
      target_profile_id: 'member-1',
    })
    expect(accessMocks.rpc).toHaveBeenNthCalledWith(2, 'admin_update_webchat_member_access', {
      target_profile_id: 'member-1',
      requested_access_enabled: true,
      requested_daily_request_limit: 12,
      requested_daily_token_limit: 50_000,
      expected_version: 3,
      reason: '开放首批试运行',
    })
  })

  it('surfaces an optimistic-lock conflict as a dedicated error', async () => {
    accessMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'webchat_member_access_conflict' },
    })

    await expect(
      updateAdminWebChatMemberAccess({
        memberId: 'member-1',
        enabled: false,
        dailyRequestLimit: 10,
        dailyTokenLimit: 40_000,
        expectedVersion: 2,
        reason: '调整试运行额度',
      }),
    ).rejects.toBeInstanceOf(WebChatMemberAccessConflictError)
  })

  it('maps only the current member aggregate usage and validates remaining values', async () => {
    accessMocks.rpc.mockResolvedValue({ data: [usageRow], error: null })

    await expect(fetchOwnWebChatUsage()).resolves.toEqual({
      enabled: true,
      model: 'gpt-5.6-sol',
      usageDate: '2026-07-17',
      resetAt: '2026-07-17T16:00:00Z',
      requests: { limit: 12, used: 4, remaining: 8 },
      tokens: { limit: 50_000, settled: 9_000, reserved: 3_000, remaining: 38_000 },
    })
    expect(accessMocks.rpc).toHaveBeenCalledWith('read_own_webchat_usage')
  })

  it('rejects malformed or internally inconsistent database projections', () => {
    expect(() => mapWebChatMemberAccess([{ ...accessRow, daily_request_limit: 0 }])).toThrow(
      /无效数据/,
    )
    expect(() => mapWebChatMemberUsage([{ ...usageRow, remaining_tokens: 40_000 }])).toThrow(
      /不一致/,
    )
    expect(() => mapWebChatMemberUsage([{ ...usageRow, reset_at: 'not-a-date' }])).toThrow(
      /重置时间/,
    )
    expect(() => mapWebChatMemberUsage([{ ...usageRow, model: 'unsafe model' }])).toThrow(
      /无效数据/,
    )
  })
})
