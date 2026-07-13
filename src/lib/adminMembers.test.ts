import { mapAdminMember } from './adminMembers'

describe('admin member mapping', () => {
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
})
