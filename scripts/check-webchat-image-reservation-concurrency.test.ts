import {
  assertConcurrentReservationResults,
  findSupabaseDatabaseContainer,
  parseGlobalImageConfigSnapshot,
} from './check-webchat-image-reservation-concurrency.mjs'

describe('WebChat image reservation concurrency checker', () => {
  it('finds the single database container for the configured Supabase project', () => {
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

  it('requires an unambiguous local database container', () => {
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

  it('preserves a complete non-default global image configuration snapshot', () => {
    expect(
      parseGlobalImageConfigSnapshot(
        JSON.stringify({
          image_uploads_paused: false,
          image_hourly_attachment_limit: 731,
          image_hourly_original_bytes_limit: 987654321,
          image_storage_capacity_bytes: 876543210,
          image_max_active_validations: 17,
        }),
      ),
    ).toEqual({
      image_uploads_paused: false,
      image_hourly_attachment_limit: 731,
      image_hourly_original_bytes_limit: 987654321,
      image_storage_capacity_bytes: 876543210,
      image_max_active_validations: 17,
    })
  })

  it('rejects missing, extra, malformed, or out-of-range global image configuration', () => {
    expect(() => parseGlobalImageConfigSnapshot('{')).toThrow(/not valid JSON/)
    expect(() =>
      parseGlobalImageConfigSnapshot(
        JSON.stringify({
          image_uploads_paused: true,
          image_hourly_attachment_limit: 120,
          image_hourly_original_bytes_limit: 268435456,
          image_storage_capacity_bytes: 536870912,
        }),
      ),
    ).toThrow(/invalid or incomplete/)
    expect(() =>
      parseGlobalImageConfigSnapshot(
        JSON.stringify({
          image_uploads_paused: true,
          image_hourly_attachment_limit: 10001,
          image_hourly_original_bytes_limit: 268435456,
          image_storage_capacity_bytes: 536870912,
          image_max_active_validations: 2,
          unexpected: true,
        }),
      ),
    ).toThrow(/invalid or incomplete/)
  })

  it('accepts only the serialized 30th-success and 31st-rate-limit outcome', () => {
    expect(() =>
      assertConcurrentReservationResults({
        a: {
          code: 0,
          timedOut: false,
          stdout: 'A_RESERVED|00000000-0000-4000-8000-00000000d030\n',
          stderr: '',
        },
        b: {
          code: 3,
          timedOut: false,
          stdout: '',
          stderr:
            'ERROR:  54000: WebChat member image upload rate limit reached.\nLOCATION: exec_stmt_raise, pl_exec.c:3905\n',
        },
        verification: '30|1|0',
      }),
    ).not.toThrow()
  })

  it('rejects a bypassed rate limit, the wrong SQLSTATE, or final-count drift', () => {
    const successfulA = {
      code: 0,
      timedOut: false,
      stdout: 'A_RESERVED|00000000-0000-4000-8000-00000000d030\n',
      stderr: '',
    }
    expect(() =>
      assertConcurrentReservationResults({
        a: successfulA,
        b: { code: 0, timedOut: false, stdout: 'B_RESERVED', stderr: '' },
        verification: '31|1|1',
      }),
    ).toThrow(/did not fail reservation 31/)
    expect(() =>
      assertConcurrentReservationResults({
        a: successfulA,
        b: {
          code: 3,
          timedOut: false,
          stdout: '',
          stderr: 'ERROR:  55P03: canceling statement due to lock timeout',
        },
        verification: '30|1|0',
      }),
    ).toThrow(/SQLSTATE 54000/)
    expect(() =>
      assertConcurrentReservationResults({
        a: successfulA,
        b: {
          code: 3,
          timedOut: false,
          stdout: '',
          stderr: 'ERROR:  54000: WebChat member image upload rate limit reached.',
        },
        verification: '29|1|0',
      }),
    ).toThrow(/exactly 30 recent reservations/)
  })
})
