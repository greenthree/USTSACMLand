const pilotMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc: pilotMocks.rpc } }))

import { fetchAdminWebChatPilotMembers, mapAdminWebChatPilotMembers } from './adminWebChatPilot'

const pilotRow = {
  user_id: '00000000-0000-4000-8000-000000000101',
  full_name: '测试成员',
  grade: '24级',
  major: '计算机科学与技术',
  role: 'member',
  review_status: 'approved',
  access_enabled: true,
  daily_request_limit: 20,
  daily_token_limit: 80_000,
  usage_date: '2026-07-18',
  request_count: 6,
  settled_tokens: 12_000,
  reserved_tokens: 3_000,
  remaining_requests: 14,
  remaining_tokens: 65_000,
  active_request_count: 1,
  last_request_at: '2026-07-18T08:00:00Z',
  version: 2,
  updated_at: '2026-07-17T12:00:00Z',
}

describe('administrator WebChat pilot observability adapter', () => {
  beforeEach(() => pilotMocks.rpc.mockReset())

  it('maps only the bounded member policy and aggregate usage projection', async () => {
    pilotMocks.rpc.mockResolvedValue({ data: [pilotRow], error: null })

    await expect(fetchAdminWebChatPilotMembers()).resolves.toEqual([
      {
        id: pilotRow.user_id,
        name: '测试成员',
        grade: '24级',
        major: '计算机科学与技术',
        role: 'member',
        accountStatus: 'approved',
        accessEnabled: true,
        dailyRequestLimit: 20,
        dailyTokenLimit: 80_000,
        usageDate: '2026-07-18',
        requestCount: 6,
        settledTokens: 12_000,
        reservedTokens: 3_000,
        remainingRequests: 14,
        remainingTokens: 65_000,
        activeRequestCount: 1,
        lastRequestAt: '2026-07-18T08:00:00Z',
        version: 2,
        updatedAt: '2026-07-17T12:00:00Z',
      },
    ])
    expect(pilotMocks.rpc).toHaveBeenCalledWith('admin_list_webchat_pilot_members')
  })

  it('accepts bigint strings and nullable profile/request fields', () => {
    expect(
      mapAdminWebChatPilotMembers([
        {
          ...pilotRow,
          full_name: null,
          grade: null,
          major: null,
          daily_token_limit: '80000',
          settled_tokens: '12000',
          reserved_tokens: '3000',
          remaining_tokens: '65000',
          last_request_at: null,
        },
      ])[0],
    ).toMatchObject({
      name: '未填写姓名',
      grade: null,
      major: null,
      lastRequestAt: null,
      dailyTokenLimit: 80_000,
    })
  })

  it('rejects malformed identities, timestamps, and inconsistent remaining quota', () => {
    expect(() => mapAdminWebChatPilotMembers([{ ...pilotRow, user_id: 'not-a-uuid' }])).toThrow(
      /无效数据/,
    )
    expect(() => mapAdminWebChatPilotMembers([{ ...pilotRow, updated_at: 'not-a-date' }])).toThrow(
      /配置更新时间/,
    )
    expect(() => mapAdminWebChatPilotMembers([{ ...pilotRow, remaining_tokens: 66_000 }])).toThrow(
      /不一致/,
    )
    expect(() => mapAdminWebChatPilotMembers([{ ...pilotRow, active_request_count: 2 }])).toThrow(
      /不一致/,
    )
  })
})
