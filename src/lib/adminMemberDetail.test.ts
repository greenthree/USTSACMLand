const detailMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc: detailMocks.rpc } }))

import {
  mapAdminMemberActivity,
  mapAdminMemberDetail,
  setAdminManualPlatformStats,
  unbindAdminMemberPlatformAccount,
  upsertAdminMemberPlatformAccount,
} from './adminMemberDetail'

const baseRow = {
  id: 'member-1',
  email: 'member@example.edu.cn',
  full_name: '测试成员',
  qq: '12345678',
  grade: '24级',
  major: '计算机科学与技术',
  review_status: 'approved' as const,
  suspension_note: null,
  is_public: true,
  created_at: '2026-07-14T07:00:00Z',
  updated_at: '2026-07-14T08:00:00Z',
  platform: 'codeforces' as const,
  account_id: '10',
  external_id: 'TestHandle',
  account_status: 'verified' as const,
  verified_at: '2026-07-14T07:30:00Z',
  verification_error_message: null,
  account_updated_at: '2026-07-14T07:30:00Z',
  current_rating: 1700,
  max_rating: 1800,
  solved_count: 500,
  stat_status: 'fresh' as const,
  source_observed_at: '2026-07-14T07:50:00Z',
  last_success_at: '2026-07-14T08:00:00Z',
  stale_after: '2026-07-14T13:00:00Z',
  source_version: 'codeforces-api-v1',
  stat_updated_at: '2026-07-14T08:00:00Z',
}

describe('administrator member detail data', () => {
  beforeEach(() => {
    detailMocks.rpc.mockReset()
  })

  it('maps profile, bound account, missing account, and activity rows', () => {
    const activity = mapAdminMemberActivity({
      event_id: 'audit:1',
      event_kind: 'audit',
      target_table: 'platform_stats',
      action: 'manual_stats_updated',
      platform: 'codeforces',
      run_status: null,
      detail: '补录比赛数据',
      source_version: null,
      created_at: '2026-07-14T08:00:00Z',
    })
    const detail = mapAdminMemberDetail(
      [
        baseRow,
        {
          ...baseRow,
          platform: 'atcoder',
          account_id: null,
          external_id: null,
          account_status: null,
          verified_at: null,
          account_updated_at: null,
          current_rating: null,
          max_rating: null,
          solved_count: null,
          stat_status: null,
          source_version: null,
          stat_updated_at: null,
        },
      ],
      [
        {
          event_id: 'audit:1',
          event_kind: 'audit',
          target_table: 'platform_stats',
          action: 'manual_stats_updated',
          platform: 'codeforces',
          run_status: null,
          detail: '补录比赛数据',
          source_version: null,
          created_at: '2026-07-14T08:00:00Z',
        },
      ],
    )

    expect(detail).toMatchObject({
      name: '测试成员',
      platformCount: 1,
      verifiedPlatformCount: 1,
      platforms: [
        { accountId: 10, accountStatus: 'verified', currentRating: 1700 },
        { platform: 'atcoder', accountId: null, accountStatus: 'missing', statStatus: 'missing' },
      ],
    })
    expect(detail?.activity[0]).toEqual(activity)
  })

  it('sends platform account and manual statistic writes through dedicated RPCs', async () => {
    detailMocks.rpc.mockResolvedValue({ data: null, error: null })

    await upsertAdminMemberPlatformAccount(
      'member-1',
      'codeforces',
      'NewHandle',
      '2026-07-14T08:00:00Z',
    )
    await unbindAdminMemberPlatformAccount('member-1', 'codeforces', '2026-07-14T09:00:00Z')
    await setAdminManualPlatformStats(
      'member-1',
      'codeforces',
      {
        currentRating: 1800,
        maxRating: 1900,
        solvedCount: 600,
        sourceObservedAt: '2026-07-14T09:30:00Z',
        note: '补录比赛数据',
      },
      '2026-07-14T09:00:00Z',
    )

    expect(detailMocks.rpc).toHaveBeenNthCalledWith(1, 'admin_upsert_member_platform_account', {
      target_profile_id: 'member-1',
      target_platform: 'codeforces',
      new_external_id: 'NewHandle',
      expected_updated_at: '2026-07-14T08:00:00Z',
    })
    expect(detailMocks.rpc).toHaveBeenNthCalledWith(2, 'admin_unbind_member_platform_account', {
      target_profile_id: 'member-1',
      target_platform: 'codeforces',
      expected_updated_at: '2026-07-14T09:00:00Z',
    })
    expect(detailMocks.rpc).toHaveBeenNthCalledWith(3, 'admin_set_manual_platform_stats', {
      target_profile_id: 'member-1',
      target_platform: 'codeforces',
      manual_current_rating: 1800,
      manual_max_rating: 1900,
      manual_solved_count: 600,
      manual_source_observed_at: '2026-07-14T09:30:00Z',
      manual_note: '补录比赛数据',
      expected_stat_updated_at: '2026-07-14T09:00:00Z',
    })
  })
})
