import {
  buildDenoArguments,
  fixtureCleanupAuditSql,
  parseProductionApiKeys,
  parseLinkedProjectRef,
  parseSupabaseStatusEnv,
  preclaimFixtureRetrySql,
  runSyncPlatformOutageCheck,
} from './check-sync-platform-outage.mjs'

const productionProjectRef = 'abcdefghijklmnopqrst'

function productionHarness({ failSetupResponse = false, failCleanupResponse = false } = {}) {
  const events: string[] = []
  let setupFailed = false
  let cleanupFailed = false
  const execFile = (_command: string, args: string[]) => {
    if (args.includes('projects') && args.includes('list')) {
      events.push('linked_project')
      return JSON.stringify([{ ref: productionProjectRef, linked: true }])
    }
    if (args.includes('api-keys')) {
      events.push('api_keys')
      return JSON.stringify([
        { name: 'anon', type: 'legacy', api_key: 'anon-value' },
        { name: 'service_role', type: 'legacy', api_key: 'service-value' },
      ])
    }
    const queryIndex = args.indexOf('query')
    if (queryIndex === -1) throw new Error(`Unexpected command: ${args.join(' ')}`)
    const sql = args[queryIndex + 2]
    if (sql.includes('insert into auth.users')) {
      events.push('fixture_setup')
      if (failSetupResponse && !setupFailed) {
        setupFailed = true
        throw Object.assign(new Error('synthetic setup response loss'), { status: 1 })
      }
      return JSON.stringify({ rows: [] })
    }
    if (sql.includes('Expected to preclaim exactly one fixture retry')) {
      events.push('fixture_retry_preclaim')
      const profileId = sql.match(/profile_id = '([0-9a-f-]{36})'::uuid/)?.[1]
      if (!profileId) throw new Error('Could not read fixture profile id from preclaim SQL.')
      return JSON.stringify({
        rows: [
          {
            job_id: '42',
            profile_id: profileId,
            platform: 'codeforces',
            attempt_count: 2,
            max_attempts: 2,
          },
        ],
      })
    }
    if (sql.includes('Integration fixture cleanup closed an incomplete run')) {
      events.push('fixture_cleanup')
      if (failCleanupResponse && !cleanupFailed) {
        cleanupFailed = true
        throw Object.assign(new Error('synthetic cleanup response loss'), { status: 1 })
      }
      return JSON.stringify({ rows: [] })
    }
    if (sql.includes('as stat_snapshots') && sql.includes('as scheduler_active')) {
      events.push('fixture_cleanup_audit')
      return JSON.stringify({
        rows: [
          {
            auth_users: 0,
            profiles: 0,
            platform_accounts: 0,
            platform_stats: 0,
            sync_jobs: 0,
            sync_runs: 0,
            stat_snapshots: 0,
            scheduler_active: true,
          },
        ],
      })
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  }
  const spawn = (_command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
    if (args[0] === '--version') {
      events.push('deno_version')
      return { status: 0 }
    }
    const phase = options?.env?.SYNC_OUTAGE_PHASE
    events.push(`phase_${phase ?? 'missing'}`)
    if (phase === 'retry' && options?.env?.SYNC_OUTAGE_PRECLAIMED_JOB_ID !== '42') {
      return { status: 1 }
    }
    return { status: 0 }
  }
  return { events, execFile, spawn }
}

describe('single-platform outage integration runner', () => {
  it('reads only the required local Supabase connection values', () => {
    expect(
      parseSupabaseStatusEnv(
        [
          'ANON_KEY="local-anon"',
          'API_URL="http://127.0.0.1:54321"',
          'SERVICE_ROLE_KEY="local-service"',
          'DB_URL="postgresql://ignored"',
        ].join('\n'),
      ),
    ).toMatchObject({
      ANON_KEY: 'local-anon',
      API_URL: 'http://127.0.0.1:54321',
      SERVICE_ROLE_KEY: 'local-service',
    })
  })

  it('fails closed when the local service credential is unavailable', () => {
    expect(() =>
      parseSupabaseStatusEnv('ANON_KEY="local-anon"\nAPI_URL="http://127.0.0.1:54321"'),
    ).toThrow(/SERVICE_ROLE_KEY/)
  })

  it('restricts Deno network access to the local Supabase API', () => {
    const args = buildDenoArguments()
    expect(args).toContain('--allow-net=127.0.0.1:54321,localhost:54321')
    expect(args.some((argument) => argument === '--allow-net' || argument === '-A')).toBe(false)
    expect(args.some((argument) => argument.includes('0.0.0.0'))).toBe(false)
  })

  it('restricts a production drill to the selected Supabase project host', () => {
    const args = buildDenoArguments('exampleprojectref123.supabase.co')
    expect(args).toContain('--allow-net=exampleprojectref123.supabase.co')
    expect(args.some((argument) => argument.includes('localhost'))).toBe(false)
  })

  it('requires the CLI linked project to match the production project', () => {
    expect(
      parseLinkedProjectRef([{ ref: productionProjectRef, linked: true }], productionProjectRef),
    ).toBe(productionProjectRef)
    expect(() =>
      parseLinkedProjectRef([{ ref: 'zyxwvutsrqponmlkjihg', linked: true }], productionProjectRef),
    ).toThrow(/does not match/)
    expect(() =>
      parseLinkedProjectRef(
        [
          { ref: productionProjectRef, linked: true },
          { ref: 'zyxwvutsrqponmlkjihg', linked: true },
        ],
        productionProjectRef,
      ),
    ).toThrow(/exactly one/)
  })

  it('selects only legacy anon and service role keys for the production drill', () => {
    expect(
      parseProductionApiKeys(
        [
          { name: 'anon', type: 'legacy', api_key: 'anon-value' },
          { name: 'service_role', type: 'legacy', api_key: 'service-value' },
          { name: 'default', type: 'secret', api_key: 'ignored' },
        ],
        productionProjectRef,
      ),
    ).toEqual({
      ANON_KEY: 'anon-value',
      API_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      SERVICE_ROLE_KEY: 'service-value',
    })
  })

  it('preclaims only the named fixture retry and never calls the global claim RPC', () => {
    const profileId = '11111111-1111-4111-8111-111111111111'
    const sql = preclaimFixtureRetrySql(profileId)
    expect(sql).toContain(`profile_id = '${profileId}'::uuid`)
    expect(sql).toContain("platform = 'codeforces'")
    expect(sql).toContain("status = 'queued'")
    expect(sql).toContain('attempt_count = 1')
    expect(sql).toContain('max_attempts = 2')
    expect(sql).not.toContain('claim_due_sync_jobs')
  })

  it('audits every fixture table and the live scheduler after cleanup', () => {
    const sql = fixtureCleanupAuditSql('11111111-1111-4111-8111-111111111111')
    for (const table of [
      'auth.users',
      'public.profiles',
      'public.platform_accounts',
      'public.platform_stats',
      'public.sync_jobs',
      'public.sync_runs',
      'public.stat_snapshots',
      'cron.job',
    ]) {
      expect(sql).toContain(table)
    }
  })

  it('runs the production drill with a fixture-only preclaim and cleanup audit', async () => {
    const harness = productionHarness()
    await runSyncPlatformOutageCheck({
      platform: 'linux',
      production: true,
      projectRef: productionProjectRef,
      execFile: harness.execFile,
      spawn: harness.spawn,
    })
    expect(harness.events).toEqual([
      'linked_project',
      'api_keys',
      'deno_version',
      'fixture_setup',
      'phase_initial',
      'fixture_retry_preclaim',
      'phase_retry',
      'fixture_cleanup',
      'fixture_cleanup_audit',
    ])
  })

  it('cleans and audits a possible committed fixture when setup response is lost', async () => {
    const harness = productionHarness({ failSetupResponse: true })
    await expect(
      runSyncPlatformOutageCheck({
        platform: 'linux',
        production: true,
        projectRef: productionProjectRef,
        execFile: harness.execFile,
        spawn: harness.spawn,
      }),
    ).rejects.toThrow(/fixture_setup/)
    expect(harness.events).toEqual([
      'linked_project',
      'api_keys',
      'deno_version',
      'fixture_setup',
      'fixture_cleanup',
      'fixture_cleanup_audit',
    ])
  })

  it('accepts a lost cleanup response only after a zero-row reconciliation', async () => {
    const harness = productionHarness({ failCleanupResponse: true })
    await runSyncPlatformOutageCheck({
      platform: 'linux',
      production: true,
      projectRef: productionProjectRef,
      execFile: harness.execFile,
      spawn: harness.spawn,
    })
    expect(harness.events.slice(-2)).toEqual(['fixture_cleanup', 'fixture_cleanup_audit'])
  })

  it('refuses a mismatched linked project before reading credentials or writing SQL', async () => {
    const events: string[] = []
    const execFile = (_command: string, args: string[]) => {
      events.push(args.join(' '))
      return JSON.stringify([{ ref: 'zyxwvutsrqponmlkjihg', linked: true }])
    }
    await expect(
      runSyncPlatformOutageCheck({
        platform: 'linux',
        production: true,
        projectRef: productionProjectRef,
        execFile,
        spawn: () => ({ status: 0 }),
      }),
    ).rejects.toThrow(/does not match/)
    expect(events).toHaveLength(1)
    expect(events[0]).toContain('projects list')
  })
})
