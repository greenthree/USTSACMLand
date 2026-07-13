import { mapAdminReviewMember } from './adminMembers'

describe('admin member review mapping', () => {
  it('maps RPC rows into the frontend review model', () => {
    expect(
      mapAdminReviewMember({
        id: 'member-1',
        email: 'member@example.edu.cn',
        full_name: '测试成员',
        major: '计算机科学与技术',
        grade: '24级',
        qq: '123456789',
        review_status: 'pending',
        review_note: '等待核验',
        review_requested_at: '2026-07-12T12:00:00Z',
        updated_at: '2026-07-12T12:05:00Z',
        platform_count: 4,
      }),
    ).toEqual({
      id: 'member-1',
      name: '测试成员',
      major: '计算机科学与技术',
      grade: '24级',
      qq: '123456789',
      email: 'member@example.edu.cn',
      submittedAt: '2026-07-12T12:00:00Z',
      updatedAt: '2026-07-12T12:05:00Z',
      reviewStatus: 'pending',
      reviewNote: '等待核验',
      platformCount: 4,
    })
  })

  it('uses display fallbacks for incomplete pending profiles', () => {
    const member = mapAdminReviewMember({
      id: 'member-2',
      email: null,
      full_name: null,
      major: null,
      grade: null,
      qq: null,
      review_status: 'pending',
      review_note: null,
      review_requested_at: '2026-07-12T12:00:00Z',
      updated_at: '2026-07-12T12:05:00Z',
      platform_count: 0,
    })

    expect(member).toMatchObject({
      name: '未填写姓名',
      major: '未填写专业',
      grade: '未填写年级',
      qq: '--',
      email: '--',
      platformCount: 0,
    })
  })
})
