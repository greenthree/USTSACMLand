const pilotMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc: pilotMocks.rpc } }))

import {
  fetchAdminWebChatCacheSummary,
  fetchAdminWebChatPilotMembers,
  mapAdminWebChatCacheSummary,
  mapAdminWebChatPilotMembers,
} from './adminWebChatPilot'

const pilotRow = {
  user_id: '00000000-0000-4000-8000-000000000101',
  full_name: '测试成员',
  grade: '24级',
  major: '计算机科学与技术',
  role: 'member',
  review_status: 'approved',
  access_enabled: true,
  total_request_limit: 20,
  total_token_limit: 80_000,
  used_requests: 6,
  used_tokens: 12_000,
  reserved_tokens: 3_000,
  remaining_requests: 14,
  remaining_tokens: 65_000,
  active_request_count: 1,
  last_request_at: '2026-07-18T08:00:00Z',
  version: 2,
  updated_at: '2026-07-17T12:00:00Z',
}

describe('administrator WebChat account usage adapter', () => {
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
        totalRequestLimit: 20,
        totalTokenLimit: 80_000,
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
          total_token_limit: '80000',
          used_tokens: '12000',
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
      totalTokenLimit: 80_000,
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

  it('maps only aggregate real-request cache counters', async () => {
    const row = {
      observed_requests: '12',
      eligible_requests: '10',
      cache_hit_requests: '7',
      eligible_input_tokens: '20000',
      cached_input_tokens: '12000',
      cache_write_tokens: '8000',
    }
    pilotMocks.rpc.mockResolvedValue({ data: [row], error: null })

    await expect(fetchAdminWebChatCacheSummary()).resolves.toEqual({
      observedRequests: 12,
      eligibleRequests: 10,
      cacheHitRequests: 7,
      eligibleInputTokens: 20_000,
      cachedInputTokens: 12_000,
      cacheWriteTokens: 8_000,
    })
    expect(pilotMocks.rpc).toHaveBeenCalledWith('admin_read_webchat_cache_summary')
  })

  it('rejects inconsistent aggregate cache counters', () => {
    expect(() =>
      mapAdminWebChatCacheSummary([
        {
          observed_requests: 1,
          eligible_requests: 1,
          cache_hit_requests: 2,
          eligible_input_tokens: 100,
          cached_input_tokens: 101,
          cache_write_tokens: 0,
        },
      ]),
    ).toThrow(/不一致/)
  })
})
