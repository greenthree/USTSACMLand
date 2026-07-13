const adminMemberMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { rpc: adminMemberMocks.rpc },
}))

import { mapAdminMember, updateAdminMemberProfile } from './adminMembers'

describe('admin member mapping', () => {
  beforeEach(() => {
    adminMemberMocks.rpc.mockReset()
  })

  it('maps active member counts and private profile fields', () => {
    expect(
      mapAdminMember({
        id: 'member-1',
        email: 'member@example.edu.cn',
        full_name: '测试成员',
        major: '计算机科学与技术',
        grade: '24级',
        qq: '12345678',
        review_status: 'approved',
        suspension_note: null,
        is_public: true,
        created_at: '2026-07-13T09:00:00Z',
        updated_at: '2026-07-13T10:00:00Z',
        platform_count: '5',
        verified_platform_count: 4,
      }),
    ).toEqual({
      id: 'member-1',
      name: '测试成员',
      email: 'member@example.edu.cn',
      qq: '12345678',
      major: '计算机科学与技术',
      grade: '24级',
      status: 'active',
      suspensionNote: null,
      isPublic: true,
      joinedAt: '2026-07-13T09:00:00Z',
      updatedAt: '2026-07-13T10:00:00Z',
      platformCount: 5,
      verifiedPlatformCount: 4,
    })
  })

  it('maps suspended and incomplete profiles with safe display fallbacks', () => {
    expect(
      mapAdminMember({
        id: 'member-2',
        email: null,
        full_name: null,
        major: null,
        grade: null,
        qq: null,
        review_status: 'suspended',
        suspension_note: '已离队',
        is_public: false,
        created_at: '2026-07-13T09:00:00Z',
        updated_at: '2026-07-13T10:00:00Z',
        platform_count: 0,
        verified_platform_count: '0',
      }),
    ).toMatchObject({
      name: '未填写姓名',
      email: '--',
      qq: '--',
      major: '未填写专业',
      grade: '未填写年级',
      status: 'suspended',
      suspensionNote: '已离队',
      platformCount: 0,
      verifiedPlatformCount: 0,
    })
  })

  it('sends editable profile fields with the optimistic-lock timestamp', async () => {
    adminMemberMocks.rpc.mockResolvedValue({
      data: '2026-07-14T08:00:00Z',
      error: null,
    })

    await expect(
      updateAdminMemberProfile(
        'member-1',
        {
          name: '测试成员',
          qq: '12345678',
          grade: '24级',
          major: '计算机科学与技术',
          isPublic: true,
        },
        '2026-07-14T07:00:00Z',
      ),
    ).resolves.toBe('2026-07-14T08:00:00Z')

    expect(adminMemberMocks.rpc).toHaveBeenCalledWith('admin_update_member_profile', {
      target_profile_id: 'member-1',
      member_full_name: '测试成员',
      member_qq: '12345678',
      member_grade: '24级',
      member_major: '计算机科学与技术',
      member_is_public: true,
      expected_updated_at: '2026-07-14T07:00:00Z',
    })
  })
})
