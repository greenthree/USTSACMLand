import {
  assertConcurrencyResult,
  findLocalDatabaseContainer,
} from './check-training-goal-concurrency.mjs'

const success = (stdout: string) => ({
  code: 0,
  timedOut: false,
  stdout: `${stdout}\n`,
  stderr: '',
})

describe('training-goal concurrency checker', () => {
  it('selects exactly one running database from the expected local Supabase project', () => {
    expect(
      findLocalDatabaseContainer({
        project: 'test-project',
        run: (_command, args) => {
          if (args[0] === 'ps') {
            expect(args).toContain('label=com.supabase.cli.project=test-project')
            return 'supabase_rest_test-project\nsupabase_db_test-project\n'
          }
          expect(args[0]).toBe('inspect')
          return 'test-project|true\n'
        },
      }),
    ).toBe('supabase_db_test-project')
  })

  it('rejects unsafe names, ambiguous discovery, stopped containers, and wrong project labels', () => {
    expect(() => findLocalDatabaseContainer({ configured: 'postgres.example.com' })).toThrow(
      /exactly one local Supabase database container/,
    )
    expect(() =>
      findLocalDatabaseContainer({
        project: 'duplicate',
        run: () => 'supabase_db_one\nsupabase_db_two\n',
      }),
    ).toThrow(/found 2/)
    expect(() =>
      findLocalDatabaseContainer({
        configured: 'supabase_db_stopped',
        project: 'expected-project',
        run: () => 'expected-project|false\n',
      }),
    ).toThrow(/not the running local database/)
    expect(() =>
      findLocalDatabaseContainer({
        configured: 'supabase_db_other',
        project: 'expected-project',
        run: () => 'other-project|true\n',
      }),
    ).toThrow(/not the running local database/)
  })

  it('accepts exactly one committed create and a quota-rejected contender', () => {
    expect(() =>
      assertConcurrencyResult({
        first: success('A_READY\nA_COMMITTED'),
        second: success('B_REJECTED'),
        verification: '20|1|0',
      }),
    ).not.toThrow()
  })

  it('rejects a contender that succeeds or a final active count above the quota', () => {
    const first = success('A_READY\nA_COMMITTED')

    expect(() =>
      assertConcurrencyResult({
        first,
        second: success('B_CREATED'),
        verification: '21|1|1',
      }),
    ).toThrow(/second create was not rejected/)
    expect(() =>
      assertConcurrencyResult({
        first,
        second: success('B_REJECTED'),
        verification: '21|1|0',
      }),
    ).toThrow(/Expected 20 active goals/)
  })
})
