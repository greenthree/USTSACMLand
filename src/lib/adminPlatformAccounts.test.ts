import { mapAdminPlatformAccount } from './adminPlatformAccounts'

describe('admin platform account mapping', () => {
  it('maps RPC rows into the frontend account review model', () => {
    expect(
      mapAdminPlatformAccount({
        id: '42',
        profile_id: 'member-1',
        full_name: '测试成员',
        major: '计算机科学与技术',
        email: 'member@example.edu.cn',
        platform: 'luogu',
        external_id: '409073',
        status: 'invalid',
        verified_at: null,
        verification_error_code: 'invalid_account',
        verification_error_message: '用户不存在',
        updated_at: '2026-07-13T12:00:00Z',
      }),
    ).toEqual({
      id: 42,
      profileId: 'member-1',
      memberName: '测试成员',
      major: '计算机科学与技术',
      email: 'member@example.edu.cn',
      platform: 'luogu',
      externalId: '409073',
      status: 'invalid',
      verifiedAt: null,
      verificationErrorCode: 'invalid_account',
      verificationErrorMessage: '用户不存在',
      updatedAt: '2026-07-13T12:00:00Z',
    })
  })

  it('uses safe display fallbacks for incomplete member profiles', () => {
    expect(
      mapAdminPlatformAccount({
        id: 7,
        profile_id: 'member-2',
        full_name: null,
        major: null,
        email: null,
        platform: 'codeforces',
        external_id: 'Tourist',
        status: 'pending',
        verified_at: null,
        verification_error_code: null,
        verification_error_message: null,
        updated_at: '2026-07-13T12:00:00Z',
      }),
    ).toMatchObject({
      memberName: '未填写姓名',
      major: '未填写专业',
      email: '--',
    })
  })
})
