import {
  assertAccountDeletionConcurrencyResults,
  assertStorageDeleteThenUploadResults,
  assertStorageUploadThenDeleteResults,
  findSupabaseDatabaseContainer,
} from './check-account-deletion-concurrency.mjs'

describe('account-deletion concurrency checker', () => {
  it('finds exactly one local Supabase database container', () => {
    expect(
      findSupabaseDatabaseContainer({
        project: 'test-project',
        run: (_command, args) => {
          expect(args).toContain('label=com.supabase.cli.project=test-project')
          return 'supabase_rest_test-project\nsupabase_db_test-project\n'
        },
      }),
    ).toBe('supabase_db_test-project')
  })

  it('refuses an ambiguous local database target', () => {
    expect(() => findSupabaseDatabaseContainer({ project: 'missing', run: () => '' })).toThrow(
      /exactly one Supabase database container/,
    )
    expect(() =>
      findSupabaseDatabaseContainer({
        project: 'duplicate',
        run: () => 'supabase_db_one\nsupabase_db_two\n',
      }),
    ).toThrow(/found 2/)
  })

  it('accepts only a committed deletion followed by a consumed-lease result', () => {
    expect(() =>
      assertAccountDeletionConcurrencyResults({
        a: { code: 0, timedOut: false, stdout: 'A|true|true\n', stderr: '' },
        b: { code: 0, timedOut: false, stdout: 'B|false|false\n', stderr: '' },
        verification: '0|0|0',
      }),
    ).not.toThrow()
  })

  it('rejects a second deletion, failed first transaction, timeout, or residual rows', () => {
    const successfulA = { code: 0, timedOut: false, stdout: 'A|true|true\n', stderr: '' }
    const consumedB = { code: 0, timedOut: false, stdout: 'B|false|false\n', stderr: '' }

    expect(() =>
      assertAccountDeletionConcurrencyResults({
        a: successfulA,
        b: { code: 0, timedOut: false, stdout: 'B|true|true\n', stderr: '' },
        verification: '0|0|0',
      }),
    ).toThrow(/consumed lease/)
    expect(() =>
      assertAccountDeletionConcurrencyResults({
        a: { code: 3, timedOut: false, stdout: '', stderr: 'transaction failed' },
        b: consumedB,
        verification: '1|1|1',
      }),
    ).toThrow(/did not commit/)
    expect(() =>
      assertAccountDeletionConcurrencyResults({
        a: { ...successfulA, timedOut: true },
        b: consumedB,
        verification: '0|0|0',
      }),
    ).toThrow(/bounded execution timeout/)
    expect(() =>
      assertAccountDeletionConcurrencyResults({
        a: successfulA,
        b: consumedB,
        verification: '0|1|0',
      }),
    ).toThrow(/rows to be absent/)
  })

  it('accepts an upload that wins before deletion and preserves every row', () => {
    expect(() =>
      assertStorageUploadThenDeleteResults({
        upload: { code: 0, timedOut: false, stdout: 'U|inserted\n', stderr: '' },
        deletion: { code: 0, timedOut: false, stdout: 'D|true|false\n', stderr: '' },
        verification: '1|1|1|1',
      }),
    ).not.toThrow()
  })

  it('accepts a deletion that wins before upload and rejects the orphan', () => {
    expect(() =>
      assertStorageDeleteThenUploadResults({
        deletion: { code: 0, timedOut: false, stdout: 'D|true|true\n', stderr: '' },
        upload: {
          code: 3,
          timedOut: false,
          stdout: '',
          stderr: 'Storage object ownership requires a live Auth user.',
        },
        verification: '0|0|0|0',
      }),
    ).not.toThrow()
  })

  it('rejects storage races that commit the wrong side or leave residual rows', () => {
    const upload = { code: 0, timedOut: false, stdout: 'U|inserted\n', stderr: '' }
    const deletion = { code: 0, timedOut: false, stdout: 'D|true|false\n', stderr: '' }
    expect(() =>
      assertStorageUploadThenDeleteResults({ upload, deletion, verification: '1|1|1|0' }),
    ).toThrow(/rows to remain/)
    expect(() =>
      assertStorageDeleteThenUploadResults({
        deletion: { code: 0, timedOut: false, stdout: 'D|true|true\n', stderr: '' },
        upload,
        verification: '0|0|0|1',
      }),
    ).toThrow(/not rejected/)
  })
})
