import {
  assertConfirmationThenPauseResults,
  assertLocalSupabaseContainer,
  assertLostResponseReplayResults,
  assertPauseThenConfirmationResults,
  assertTenthRewardRaceResults,
  findLocalSupabaseDatabaseContainer,
  isExpectedReferralOwnedPhase,
  planReferralConfigCleanup,
  referralBlockingProbeSql,
  referralConfigCasPredicateSql,
  referralControlledPauseSql,
  referralConcurrencyApplicationNames,
  referralConcurrencyOwnership,
} from './check-referral-concurrency.mjs'

const success = (stdout: string) => ({
  code: 0,
  timedOut: false,
  stdout: `${stdout}\n`,
  stderr: '',
})

describe('referral concurrency checker', () => {
  it('selects exactly one local Supabase database container', () => {
    expect(
      findLocalSupabaseDatabaseContainer({
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

  it('rejects an unsafe explicit database target or ambiguous discovery', () => {
    expect(() =>
      findLocalSupabaseDatabaseContainer({ configured: 'postgres.example.com' }),
    ).toThrow(/local Supabase database container/)
    expect(() =>
      findLocalSupabaseDatabaseContainer({
        project: 'duplicate',
        run: () => 'supabase_db_one\nsupabase_db_two\n',
      }),
    ).toThrow(/found 2/)
  })

  it('requires a running Docker container carrying a Supabase project label', () => {
    expect(
      assertLocalSupabaseContainer('supabase_db_test', {
        expectedProject: 'test-project',
        run: () => 'test-project|true\n',
      }),
    ).toBe('test-project')
    expect(() =>
      assertLocalSupabaseContainer('supabase_db_test', {
        expectedProject: 'test-project',
        run: () => '|true\n',
      }),
    ).toThrow(/not a running local Supabase/)
    expect(() =>
      assertLocalSupabaseContainer('supabase_db_test', {
        expectedProject: 'test-project',
        run: () => 'test-project|false\n',
      }),
    ).toThrow(/not a running local Supabase/)
  })

  it('rejects an explicit or discovered container from a different Supabase project', () => {
    expect(() =>
      assertLocalSupabaseContainer('supabase_db_other', {
        expectedProject: 'expected-project',
        run: () => 'other-project|true\n',
      }),
    ).toThrow(/not a running local Supabase/)
    expect(() =>
      findLocalSupabaseDatabaseContainer({
        configured: 'supabase_db_other',
        project: 'expected-project',
        run: () => 'other-project|true\n',
      }),
    ).toThrow(/not a running local Supabase/)
    expect(() =>
      findLocalSupabaseDatabaseContainer({
        project: 'expected-project',
        run: (_command, args) =>
          args[0] === 'ps' ? 'supabase_db_discovered\n' : 'other-project|true\n',
      }),
    ).toThrow(/not a running local Supabase/)
  })

  it('tags guard and replay sessions and builds relation-specific blocker probes', () => {
    const applications = referralConcurrencyApplicationNames('run-1')
    expect(Object.keys(applications)).toEqual([
      'guard',
      'confirmFirst',
      'pauseAfter',
      'replay',
      'pauseFirst',
      'confirmAfter',
      'tenth',
      'eleventh',
    ])
    expect(applications.guard).toContain('run-1')
    expect(applications.replay).toContain('run-1')

    const configProbe = referralBlockingProbeSql({
      waiterApplication: applications.pauseAfter,
      blockerApplication: applications.confirmFirst,
      targetRelation: 'private.referral_program_config',
    })
    expect(configProbe).toContain('pg_catalog.pg_blocking_pids')
    expect(configProbe).toContain(applications.confirmFirst)
    expect(configProbe).toContain("'private.referral_program_config'::regclass")
    expect(configProbe).toContain("target_lock.locktype = 'tuple'")
    expect(configProbe).toContain('blocker_target_lock')

    const codeProbe = referralBlockingProbeSql({
      waiterApplication: applications.eleventh,
      blockerApplication: applications.tenth,
      targetRelation: 'private.referral_codes',
    })
    expect(codeProbe).toContain("'private.referral_codes'::regclass")
    expect(() =>
      referralBlockingProbeSql({
        waiterApplication: 'waiter',
        blockerApplication: 'blocker',
        targetRelation: 'public.profiles',
      }),
    ).toThrow(/Unsupported referral lock relation/)
  })

  it('restores only an exact checker-owned phase and still cleans fixtures after external change', () => {
    const ownership = referralConcurrencyOwnership('run-2')
    const original = {
      enabled: false,
      version: 7,
      updated_at: '2026-07-26T00:00:00+00:00',
      updated_by: null,
      change_reason: 'Production pause',
      reopen_allowed: false,
      reopen_block_reason: 'Production gate',
    }
    const owned = {
      enabled: true,
      version: 20,
      updated_at: '2026-07-26T01:00:00+00:00',
      updated_by: null,
      change_reason: ownership.rewardPreparationReason,
      reopen_allowed: true,
      reopen_block_reason: ownership.blockReason,
    }
    expect(planReferralConfigCleanup({ current: original, original, ownership })).toEqual({
      classification: 'already_restored',
      restoreConfig: false,
      continueFixtureCleanup: true,
    })
    expect(planReferralConfigCleanup({ current: owned, original, ownership })).toEqual({
      classification: 'owned',
      restoreConfig: true,
      continueFixtureCleanup: true,
    })
    expect(
      planReferralConfigCleanup({
        current: { ...owned, version: 21, change_reason: 'External operator change' },
        original,
        ownership,
      }),
    ).toEqual({
      classification: 'external',
      restoreConfig: false,
      continueFixtureCleanup: true,
    })
  })

  it('builds a full-field CAS predicate and rejects unsafe aliases', () => {
    const current = {
      enabled: false,
      version: 11,
      updated_at: '2026-07-26T01:02:03+00:00',
      updated_by: '00000000-0000-4000-8000-00000000c001',
      change_reason: 'owned phase',
      reopen_allowed: true,
      reopen_block_reason: 'owned gate',
    }
    const predicate = referralConfigCasPredicateSql(current, 'config')
    for (const field of [
      'enabled',
      'version',
      'updated_at',
      'updated_by',
      'change_reason',
      'reopen_allowed',
      'reopen_block_reason',
    ]) {
      expect(predicate).toContain(`config.${field} is not distinct from`)
    }
    expect(() => referralConfigCasPredicateSql(current, 'config; delete')).toThrow(
      /Unsafe SQL alias/,
    )
  })

  it('requires each transition to start from its exact named owned phase', () => {
    const ownership = referralConcurrencyOwnership('run-3')
    const setup = {
      enabled: true,
      version: 0,
      updated_at: '2026-07-26T01:02:03+00:00',
      updated_by: null,
      change_reason: ownership.setupReason,
      reopen_allowed: true,
      reopen_block_reason: ownership.blockReason,
    }
    expect(isExpectedReferralOwnedPhase(setup, ownership, 'setup')).toBe(true)
    expect(isExpectedReferralOwnedPhase(setup, ownership, 'firstPause')).toBe(false)
    expect(
      isExpectedReferralOwnedPhase(
        { ...setup, change_reason: 'External same-version write' },
        ownership,
        'setup',
      ),
    ).toBe(false)
    expect(() => isExpectedReferralOwnedPhase(setup, ownership, 'unknown')).toThrow(
      /Unknown referral checker phase/,
    )
  })

  it('builds the controlled pause wrapper in production lock order before invoking the RPC', () => {
    const ownership = referralConcurrencyOwnership('run-4')
    const sql = referralControlledPauseSql({
      label: 'B',
      expectedVersion: 0,
      expectedCurrent: {
        enabled: true,
        version: 0,
        updated_at: '2026-07-26T01:02:03+00:00',
        updated_by: null,
        change_reason: ownership.setupReason,
        reopen_allowed: true,
        reopen_block_reason: ownership.blockReason,
      },
      reason: ownership.firstPauseReason,
    })
    const identity = sql.indexOf("'request.jwt.claim.sub'")
    const rateLimit = sql.indexOf('from public.consume_admin_rate_limit')
    const profileLock = sql.indexOf('from public.profiles as administrator')
    const configLock = sql.indexOf('from private.referral_program_config as config')
    const originalRpc = sql.indexOf('from public.admin_update_referral_program_config')
    expect(identity).toBeGreaterThanOrEqual(0)
    expect(rateLimit).toBeGreaterThan(identity)
    expect(profileLock).toBeGreaterThan(rateLimit)
    expect(configLock).toBeGreaterThan(profileLock)
    expect(originalRpc).toBeGreaterThan(configLock)
    expect(sql).toContain('extra checker fence')
    expect(sql).toContain('not a claim')
  })

  it('accepts a confirmation that commits before the waiting pause', () => {
    expect(() =>
      assertConfirmationThenPauseResults({
        confirmation: success('A|confirmed'),
        pause: success('B|false|1|123.45|Pause after confirmed referral'),
        verification: '1|1|6000000|1|false|1',
      }),
    ).not.toThrow()
  })

  it('rejects a missing lock-race result or incorrect confirmation accounting', () => {
    expect(() =>
      assertConfirmationThenPauseResults({
        confirmation: success('A|confirmed'),
        pause: { ...success(''), code: 3, stderr: 'lock timeout' },
        verification: '1|1|6000000|1|false|1',
      }),
    ).toThrow(/Pause transaction/)
    expect(() =>
      assertConfirmationThenPauseResults({
        confirmation: success('A|confirmed'),
        pause: success('B|false|1|123.45|Pause after confirmed referral'),
        verification: '1|2|7000000|2|false|1',
      }),
    ).toThrow(/Unexpected confirmation-before-pause/)
  })

  it('accepts only an exact lost-response replay with one audit', () => {
    const original = success('B|false|1|123.45|Pause after confirmed referral')
    expect(() =>
      assertLostResponseReplayResults({
        original,
        replay: success('R|false|1|123.45|Pause after confirmed referral'),
        verification: '1|1',
      }),
    ).not.toThrow()
    expect(() =>
      assertLostResponseReplayResults({
        original,
        replay: success('R|false|1|999.99|Pause after confirmed referral'),
        verification: '1|1',
      }),
    ).toThrow(/original committed state/)
    expect(() =>
      assertLostResponseReplayResults({
        original,
        replay: success('R|false|1|123.45|Pause after confirmed referral'),
        verification: '1|2',
      }),
    ).toThrow(/version or audit count/)
  })

  it('accepts a waiting confirmation that observes a committed pause', () => {
    expect(() =>
      assertPauseThenConfirmationResults({
        pause: success('D|false|11|123.45|Pause before pending confirmation'),
        confirmation: success('C|confirmed'),
        verification: '1|0|1|6000000|0|false|11',
      }),
    ).not.toThrow()
    expect(() =>
      assertPauseThenConfirmationResults({
        pause: success('D|false|11|123.45|Pause before pending confirmation'),
        confirmation: success('C|confirmed'),
        verification: '1|1|2|7000000|1|false|11',
      }),
    ).toThrow(/Unexpected pause-before-confirmation/)
  })

  it('accepts exactly one concurrent tenth reward and rejects over-accounting', () => {
    expect(() =>
      assertTenthRewardRaceResults({
        winner: success('E|confirmed'),
        contender: success('F|confirmed'),
        verification: '1|0|10|15000000|1|1|2',
      }),
    ).not.toThrow()
    expect(() =>
      assertTenthRewardRaceResults({
        winner: success('E|confirmed'),
        contender: success('F|confirmed'),
        verification: '1|1|11|16000000|2|2|2',
      }),
    ).toThrow(/not exact/)
  })
})
