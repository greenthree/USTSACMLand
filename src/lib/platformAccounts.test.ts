import {
  normalizePlatformAccountId,
  platformAccountSaveErrorMessage,
  validatePlatformAccountId,
  validatePlatformAccounts,
} from './platformAccounts'

describe('platform account validation', () => {
  it.each([
    ['codeforces', 'tourist'],
    ['codeforces', 'USTS_member-1'],
    ['nowcoder', '91827364'],
    ['atcoder', 'usts_member'],
    ['luogu', '409073'],
    ['qoj', 'USTS.member-1'],
  ] as const)('accepts a valid %s identifier', (platform, value) => {
    expect(validatePlatformAccountId(platform, value)).toBeNull()
  })

  it.each([
    ['codeforces', 'a'],
    ['codeforces', 'has space'],
    ['nowcoder', 'user-123'],
    ['atcoder', 'user-name'],
    ['luogu', 'P1000'],
    ['qoj', 'user name'],
  ] as const)('rejects an invalid %s identifier', (platform, value) => {
    expect(validatePlatformAccountId(platform, value)).toBeTruthy()
  })

  it('allows optional empty bindings and trims submitted identifiers', () => {
    expect(validatePlatformAccountId('codeforces', '   ')).toBeNull()
    expect(normalizePlatformAccountId('  USTS_Handle  ')).toBe('USTS_Handle')
  })

  it('canonicalizes numeric UIDs without leading zero aliases', () => {
    expect(normalizePlatformAccountId('  000409073  ', 'luogu')).toBe('409073')
    expect(normalizePlatformAccountId('00091827364', 'nowcoder')).toBe('91827364')
    expect(normalizePlatformAccountId('0000', 'luogu')).toBe('0')
  })

  it('returns field errors without losing the platform keys', () => {
    expect(
      validatePlatformAccounts({
        codeforces: 'valid_handle',
        nowcoder: 'not-a-uid',
        atcoder: '',
        luogu: '409073',
        qoj: 'valid.user',
      }),
    ).toEqual({
      codeforces: null,
      nowcoder: expect.stringContaining('UID'),
      atcoder: null,
      luogu: null,
      qoj: null,
    })
  })

  it('turns duplicate bindings into a privacy-preserving message', () => {
    expect(
      platformAccountSaveErrorMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      }),
    ).toBe('该平台账号已被绑定，请检查填写内容或联系管理员。')
  })

  it('keeps a useful fallback for unexpected save failures', () => {
    expect(platformAccountSaveErrorMessage({ code: '500', message: '暂时不可用' })).toBe(
      '平台绑定保存失败：暂时不可用',
    )
  })
})
