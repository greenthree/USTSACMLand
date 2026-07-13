import {
  accountDraftHasConflict,
  accountFormValuesEqual,
  clearAccountDraft,
  loadAccountDraft,
  mergeAccountDraft,
  saveAccountDraft,
  type AccountFormValues,
} from './accountDraft'

const values: AccountFormValues = {
  name: '测试成员',
  qq: '12345678',
  major: '计算机科学与技术',
  grade: '24级',
  accounts: {
    codeforces: 'TestHandle',
    nowcoder: '12345',
    atcoder: 'test_user',
    luogu: '67890',
    qoj: 'test-user',
  },
}

describe('account draft storage', () => {
  beforeEach(() => localStorage.clear())

  it('stores drafts per user and clears only the saved user', () => {
    saveAccountDraft('member-1', values, { ...values, major: '人工智能' })
    saveAccountDraft('member-2', values, { ...values, name: '另一成员' })

    expect(loadAccountDraft('member-1')).toMatchObject({
      base: values,
      values: { major: '人工智能' },
    })
    expect(loadAccountDraft('member-2')).toMatchObject({ values: { name: '另一成员' } })

    clearAccountDraft('member-1')
    expect(loadAccountDraft('member-1')).toBeNull()
    expect(loadAccountDraft('member-2')).not.toBeNull()
  })

  it('ignores malformed or incompatible stored values', () => {
    localStorage.setItem('usts-acm-land:account-draft:v1:member-1', '{"version":2}')
    expect(loadAccountDraft('member-1')).toBeNull()
  })

  it('stores only the explicitly supported non-sensitive fields', () => {
    const valuesWithUnexpectedFields = {
      ...values,
      email: 'member@example.edu.cn',
      password: 'must-not-be-stored',
      accessToken: 'must-not-be-stored',
      reviewStatus: 'approved',
      accounts: {
        ...values.accounts,
        xcpc_elo: 'auto:must-not-be-stored',
      },
    } as AccountFormValues

    saveAccountDraft('member-1', valuesWithUnexpectedFields, valuesWithUnexpectedFields)

    const serialized = localStorage.getItem('usts-acm-land:account-draft:v1:member-1') ?? ''
    expect(serialized).not.toContain('email')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('reviewStatus')
    expect(serialized).not.toContain('xcpc_elo')
    expect(serialized).not.toContain('must-not-be-stored')
  })

  it('compares every editable profile and platform field', () => {
    expect(accountFormValuesEqual(values, structuredClone(values))).toBe(true)
    expect(
      accountFormValuesEqual(values, {
        ...values,
        accounts: { ...values.accounts, qoj: 'changed' },
      }),
    ).toBe(false)
  })

  it('restores only locally changed fields over newer server values', () => {
    const draft = {
      version: 1 as const,
      base: values,
      values: { ...values, name: '草稿姓名' },
    }
    const serverValues = {
      ...values,
      major: '人工智能',
      accounts: { ...values.accounts, atcoder: 'new_server_id' },
    }

    expect(mergeAccountDraft(serverValues, draft)).toMatchObject({
      name: '草稿姓名',
      major: '人工智能',
      accounts: { atcoder: 'new_server_id' },
    })
    expect(accountDraftHasConflict(serverValues, draft)).toBe(false)
  })

  it('detects fields changed both locally and on the server', () => {
    const draft = {
      version: 1 as const,
      base: values,
      values: { ...values, major: '人工智能' },
    }
    expect(accountDraftHasConflict({ ...values, major: '通信工程' }, draft)).toBe(true)
  })
})
