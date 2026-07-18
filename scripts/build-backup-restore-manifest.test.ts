import { buildBackupRestoreManifest, countCopyRows } from './build-backup-restore-manifest.mjs'

const metadata = [
  'created_at=2026-07-19T00:30:00Z',
  'repository=greenthree/USTSACMLand',
  'commit=0123456789abcdef0123456789abcdef01234567',
  'run_id=123456789',
  'recovery_not_before=1970-01-01T00:00:00.000Z',
  'supabase_cli=2.109.1',
  '',
].join('\n')

const dataSql = [
  'COPY public.profiles (id, name) FROM stdin;',
  'profile-1\tMember One',
  'profile-2\tMember\\nTwo',
  '\\.',
  'COPY "public"."platform_accounts" (id) FROM stdin;',
  'account-1',
  '\\.',
  'COPY public.platform_stats (profile_id) FROM stdin;',
  'profile-1',
  '\\.',
  'COPY public.stat_snapshots (profile_id) FROM stdin;',
  '\\.',
  'COPY public.sync_runs (id) FROM stdin;',
  'run-1',
  'run-2',
  'run-3',
  '\\.',
  '',
].join('\n')

const authDataSql = [
  'COPY auth.users (id, email) FROM stdin;',
  'user-1\tone@example.test',
  '\\.',
  '',
].join('\n')

const migrationsDataSql = [
  'COPY supabase_migrations.schema_migrations (version) FROM stdin;',
  '202607120001',
  '202607120002',
  '\\.',
  '',
].join('\n')

describe('encrypted backup restore manifest', () => {
  it('counts quoted and unquoted COPY blocks without retaining row contents', () => {
    expect(Object.fromEntries(countCopyRows(dataSql))).toEqual({
      'public.profiles': 2,
      'public.platform_accounts': 1,
      'public.platform_stats': 1,
      'public.stat_snapshots': 0,
      'public.sync_runs': 3,
    })
  })

  it('builds a versioned aggregate manifest for restore comparison', () => {
    const manifest = buildBackupRestoreManifest({
      dataSql,
      authDataSql,
      migrationsDataSql,
      metadataSource: metadata,
    })

    expect(manifest).toEqual({
      schemaVersion: 1,
      createdAt: '2026-07-19T00:30:00.000Z',
      repository: 'greenthree/USTSACMLand',
      commit: '0123456789abcdef0123456789abcdef01234567',
      runId: '123456789',
      recoveryNotBefore: '1970-01-01T00:00:00.000Z',
      supabaseCli: '2.109.1',
      rowCounts: {
        profiles: 2,
        platformAccounts: 1,
        platformStats: 1,
        statSnapshots: 0,
        syncRuns: 3,
        authUsers: 1,
        migrations: 2,
      },
    })
    expect(JSON.stringify(manifest)).not.toContain('one@example.test')
    expect(JSON.stringify(manifest)).not.toContain('Member One')
  })

  it('rejects missing required table coverage', () => {
    expect(() =>
      buildBackupRestoreManifest({
        dataSql: dataSql.replace(
          'COPY public.platform_stats (profile_id) FROM stdin;\nprofile-1\n\\.\n',
          '',
        ),
        authDataSql,
        migrationsDataSql,
        metadataSource: metadata,
      }),
    ).toThrow(/public\.platform_stats/)
  })

  it('rejects duplicate table dumps', () => {
    expect(() =>
      buildBackupRestoreManifest({
        dataSql,
        authDataSql: `${authDataSql}${authDataSql}`,
        migrationsDataSql,
        metadataSource: metadata,
      }),
    ).toThrow(/repeats COPY data|repeat table/)
  })

  it('rejects unterminated COPY data', () => {
    expect(() => countCopyRows('COPY public.profiles (id) FROM stdin;\nprofile-1\n')).toThrow(
      /unterminated COPY block/,
    )
  })

  it('rejects invalid source identity metadata', () => {
    expect(() =>
      buildBackupRestoreManifest({
        dataSql,
        authDataSql,
        migrationsDataSql,
        metadataSource: metadata.replace('run_id=123456789', 'run_id=not-a-run'),
      }),
    ).toThrow(/run_id is invalid/)
  })
})
