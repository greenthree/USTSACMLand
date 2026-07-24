import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { findSupabaseDatabaseContainer, runPsql } from './check-account-deletion-concurrency.mjs'

const integrationTest = resolve(
  'supabase/functions/sync-member/platform-outage_integration_test.ts',
)

export function parseSupabaseStatusEnv(output) {
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)="(.*)"$/)
    if (match) values[match[1]] = match[2]
  }
  for (const name of ['ANON_KEY', 'API_URL', 'SERVICE_ROLE_KEY']) {
    if (!values[name]) throw new Error(`Local Supabase status did not provide ${name}.`)
  }
  return values
}

export function buildDenoArguments(allowNet = '127.0.0.1:54321,localhost:54321') {
  return [
    'test',
    '--config=supabase/functions/deno.json',
    '--allow-env=ANON_KEY,API_URL,SERVICE_ROLE_KEY,SYNC_OUTAGE_PHASE,SYNC_OUTAGE_PROFILE_ID,SYNC_OUTAGE_SUFFIX,SYNC_OUTAGE_OBSERVED_AT,SYNC_OUTAGE_PRECLAIMED_JOB_ID',
    `--allow-net=${allowNet}`,
    integrationTest,
  ]
}

export function parseLinkedProjectRef(payload, expectedProjectRef) {
  const rows = Array.isArray(payload) ? payload : payload?.projects
  if (!Array.isArray(rows)) throw new Error('Supabase project list response is invalid.')
  const linked = rows.filter((project) => project?.linked === true)
  if (linked.length !== 1 || typeof linked[0]?.ref !== 'string') {
    throw new Error('Production outage drill requires exactly one linked Supabase project.')
  }
  if (linked[0].ref !== expectedProjectRef) {
    throw new Error('Linked Supabase project does not match the production project ref.')
  }
  return linked[0].ref
}

export function parseProductionApiKeys(payload, projectRef) {
  const rows = Array.isArray(payload) ? payload : payload?.keys
  if (!Array.isArray(rows)) throw new Error('Production API key response is invalid.')
  const anonKey = rows.find((key) => key?.name === 'anon' && key?.type === 'legacy')?.api_key
  const serviceRoleKey = rows.find(
    (key) => key?.name === 'service_role' && key?.type === 'legacy',
  )?.api_key
  if (typeof anonKey !== 'string' || !anonKey) {
    throw new Error('Production anon key is unavailable.')
  }
  if (typeof serviceRoleKey !== 'string' || !serviceRoleKey) {
    throw new Error('Production service role key is unavailable.')
  }
  if (!/^[a-z0-9]{20}$/i.test(projectRef)) throw new Error('Production project ref is invalid.')
  return {
    ANON_KEY: anonKey,
    API_URL: `https://${projectRef}.supabase.co`,
    SERVICE_ROLE_KEY: serviceRoleKey,
  }
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function fixtureSetupSql(fixture) {
  return `
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  ${quoteLiteral(fixture.profileId)}::uuid,
  'authenticated', 'authenticated', ${quoteLiteral(fixture.email)}, 'fixture-password',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object('full_name', ${quoteLiteral(`同步停机演练 ${fixture.suffix}`)}),
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
);

update public.profiles
set grade = '24级', major = '计算机科学与技术', is_public = true
where id = ${quoteLiteral(fixture.profileId)}::uuid;

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id,
  status, verified_at
) values
  (
    ${quoteLiteral(fixture.profileId)}::uuid, 'codeforces',
    ${quoteLiteral(`Outage_${fixture.suffix}`)}, ${quoteLiteral(`outage_${fixture.suffix}`)},
    'verified', ${quoteLiteral(fixture.observedAt)}::timestamptz
  ),
  (
    ${quoteLiteral(fixture.profileId)}::uuid, 'atcoder',
    ${quoteLiteral(`outage_${fixture.suffix}`)}, ${quoteLiteral(`outage_${fixture.suffix}`)},
    'verified', ${quoteLiteral(fixture.observedAt)}::timestamptz
  );

insert into public.platform_stats (
  profile_id, platform, current_rating, max_rating, solved_count, status,
  source_observed_at, fetched_at, last_success_at, stale_after, source_version
) values
  (
    ${quoteLiteral(fixture.profileId)}::uuid, 'codeforces', 1600, 1800, 321, 'fresh',
    ${quoteLiteral(fixture.observedAt)}::timestamptz,
    ${quoteLiteral(fixture.observedAt)}::timestamptz,
    ${quoteLiteral(fixture.observedAt)}::timestamptz,
    ${quoteLiteral(fixture.staleAfter)}::timestamptz,
    'fixture-codeforces-before-outage'
  ),
  (
    ${quoteLiteral(fixture.profileId)}::uuid, 'atcoder', 900, 1100, 111, 'fresh',
    ${quoteLiteral(fixture.observedAt)}::timestamptz,
    ${quoteLiteral(fixture.observedAt)}::timestamptz,
    ${quoteLiteral(fixture.observedAt)}::timestamptz,
    ${quoteLiteral(fixture.staleAfter)}::timestamptz,
    'fixture-atcoder-before-sync'
  );
`
}

export function makeRetryDueSql(profileId) {
  return `
update public.sync_jobs
set scheduled_for = pg_catalog.clock_timestamp() - interval '1 second'
where profile_id = ${quoteLiteral(profileId)}::uuid
  and platform = 'codeforces'
  and status = 'queued'
  and attempt_count = 1;

do $$
begin
  if not exists (
    select 1
    from public.sync_jobs
    where profile_id = ${quoteLiteral(profileId)}::uuid
      and platform = 'codeforces'
      and status = 'queued'
      and attempt_count = 1
  ) then
    raise exception 'The first outage attempt did not produce a queued retry.';
  end if;
end;
$$;
`
}

export function preclaimFixtureRetrySql(profileId) {
  return `
do $$
declare
  affected integer;
begin
  update public.sync_jobs
  set scheduled_for = pg_catalog.clock_timestamp() - interval '1 second'
  where profile_id = ${quoteLiteral(profileId)}::uuid
    and platform = 'codeforces'
    and status = 'queued'
    and attempt_count = 1
    and max_attempts = 2;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Expected exactly one queued fixture retry, found %.', affected;
  end if;

  update public.sync_jobs
  set
    status = 'running',
    attempt_count = attempt_count + 1,
    started_at = pg_catalog.clock_timestamp(),
    finished_at = null
  where profile_id = ${quoteLiteral(profileId)}::uuid
    and platform = 'codeforces'
    and status = 'queued'
    and attempt_count = 1
    and max_attempts = 2
    and scheduled_for <= pg_catalog.clock_timestamp();
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Expected to preclaim exactly one fixture retry, claimed %.', affected;
  end if;
end;
$$;

select
  id::text as job_id,
  profile_id::text as profile_id,
  platform::text as platform,
  attempt_count::int as attempt_count,
  max_attempts::int as max_attempts
from public.sync_jobs
where profile_id = ${quoteLiteral(profileId)}::uuid
  and platform = 'codeforces'
  and status = 'running'
  and attempt_count = 2
  and max_attempts = 2;
`
}

function fixtureCleanupSql(fixture) {
  return `
update public.sync_runs
set status = 'failed', finished_at = pg_catalog.clock_timestamp(),
    duration_ms = 0, error_code = 'unknown',
    error_message = 'Integration fixture cleanup closed an incomplete run.'
where profile_id = ${quoteLiteral(fixture.profileId)}::uuid
  and status = 'running';

update public.sync_jobs
set status = 'cancelled', finished_at = pg_catalog.clock_timestamp(),
    started_at = case when status = 'queued' then null else started_at end,
    last_error_code = 'unknown',
    last_error_message = 'Integration fixture cleanup cancelled an incomplete job.'
where profile_id = ${quoteLiteral(fixture.profileId)}::uuid
  and status in ('queued', 'running');

do $$
declare
  owner_token uuid := ${quoteLiteral(fixture.ownerToken)}::uuid;
  acquired boolean;
  deletion jsonb;
begin
  if not exists (
    select 1 from auth.users where id = ${quoteLiteral(fixture.profileId)}::uuid
  ) then
    return;
  end if;
  select public.acquire_account_deletion_recovery_lease(
    owner_token,
    ${quoteLiteral(fixture.profileId)}::uuid
  ) into acquired;
  if not acquired then
    raise exception 'Could not acquire the outage fixture deletion lease.';
  end if;
  select public.delete_auth_user_with_recovery_lease(
    owner_token,
    ${quoteLiteral(fixture.profileId)}::uuid
  ) into deletion;
  if coalesce((deletion ->> 'deleted')::boolean, false) is not true then
    raise exception 'Outage fixture deletion did not complete: %', deletion;
  end if;
end;
$$;
`
}

export function fixtureCleanupAuditSql(profileId) {
  return `
select
  (select count(*)::int from auth.users where id = ${quoteLiteral(profileId)}::uuid) as auth_users,
  (select count(*)::int from public.profiles where id = ${quoteLiteral(profileId)}::uuid) as profiles,
  (select count(*)::int from public.platform_accounts where profile_id = ${quoteLiteral(profileId)}::uuid) as platform_accounts,
  (select count(*)::int from public.platform_stats where profile_id = ${quoteLiteral(profileId)}::uuid) as platform_stats,
  (select count(*)::int from public.sync_jobs where profile_id = ${quoteLiteral(profileId)}::uuid) as sync_jobs,
  (select count(*)::int from public.sync_runs where profile_id = ${quoteLiteral(profileId)}::uuid) as sync_runs,
  (select count(*)::int from public.stat_snapshots where profile_id = ${quoteLiteral(profileId)}::uuid) as stat_snapshots,
  coalesce((
    select active from cron.job where jobname = 'sync-queue-every-five-minutes'
  ), false) as scheduler_active;
`
}

function assertFixtureCleanupAudit(payload) {
  const state = payload?.rows?.[0]
  const countColumns = [
    'auth_users',
    'profiles',
    'platform_accounts',
    'platform_stats',
    'sync_jobs',
    'sync_runs',
    'stat_snapshots',
  ]
  if (
    !state ||
    countColumns.some((column) => state[column] !== 0) ||
    state.scheduler_active !== true
  ) {
    throw new Error('Production outage fixture cleanup or queue scheduler audit failed.')
  }
}

export async function runSyncPlatformOutageCheck({
  platform = process.platform,
  execFile = execFileSync,
  spawn = spawnSync,
  production = false,
  projectRef = 'qzggoqdmsvktrtnjislw',
} = {}) {
  const npx = platform === 'win32' ? process.execPath : 'npx'
  const npxPrefix =
    platform === 'win32'
      ? [resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')]
      : []
  let productionCommandStage = 'linked_project'
  const runSupabaseJson = (args) => {
    let output
    try {
      output = execFile(
        npx,
        [...npxPrefix, '--yes', 'supabase@2.109.1', ...args, '--agent', 'yes'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      )
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 'unknown'
      throw new Error(
        `A production Supabase command failed at ${productionCommandStage} with process status ${status}; SQL and credentials were redacted.`,
      )
    }
    let payload
    try {
      payload = output.trim() ? JSON.parse(output) : null
    } catch {
      throw new Error(
        `A production Supabase command returned invalid JSON at ${productionCommandStage}; SQL and credentials were redacted.`,
      )
    }
    if (payload?._tag === 'Error') {
      const code = typeof payload.error?.code === 'string' ? payload.error.code : 'unknown'
      throw new Error(
        `A production Supabase command returned ${code} at ${productionCommandStage}; SQL and credentials were redacted.`,
      )
    }
    return payload
  }
  let environment
  if (production) {
    parseLinkedProjectRef(runSupabaseJson(['projects', 'list']), projectRef)
    productionCommandStage = 'api_keys'
    environment = parseProductionApiKeys(
      runSupabaseJson(['projects', 'api-keys', '--project-ref', projectRef]),
      projectRef,
    )
  } else {
    environment = parseSupabaseStatusEnv(
      execFile(npx, [...npxPrefix, '--yes', 'supabase@2.109.1', 'status', '-o', 'env'], {
        encoding: 'utf8',
      }),
    )
  }
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  const fixture = {
    profileId: randomUUID(),
    ownerToken: randomUUID(),
    suffix,
    email: `sync-outage-${suffix}@example.test`,
    observedAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
    staleAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
  }
  const container = production ? null : findSupabaseDatabaseContainer()
  const denoCommandName = platform === 'win32' ? 'deno.exe' : 'deno'
  const denoAvailable = spawn(denoCommandName, ['--version'], { stdio: 'ignore' }).status === 0
  const denoCommand = denoAvailable ? denoCommandName : npx
  const allowedHost = production ? new URL(environment.API_URL).host : undefined
  const denoArguments = denoAvailable
    ? buildDenoArguments(allowedHost)
    : [...npxPrefix, '--yes', 'deno@2.5.6', ...buildDenoArguments(allowedHost)]
  const runSql = async (sql, stage = 'database') => {
    if (production) {
      productionCommandStage = stage
      const normalizedSql = sql.replace(/\s+/g, ' ').trim()
      return runSupabaseJson(['db', 'query', '--linked', normalizedSql])
    }
    await runPsql(container, sql, { timeoutMs: 10_000 })
    return null
  }
  const runPhase = (phase, preclaimedJobId = null) => {
    const result = spawn(denoCommand, denoArguments, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...environment,
        SYNC_OUTAGE_PHASE: phase,
        SYNC_OUTAGE_PROFILE_ID: fixture.profileId,
        SYNC_OUTAGE_SUFFIX: fixture.suffix,
        SYNC_OUTAGE_OBSERVED_AT: fixture.observedAt,
        ...(preclaimedJobId === null
          ? {}
          : { SYNC_OUTAGE_PRECLAIMED_JOB_ID: String(preclaimedJobId) }),
      },
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Single-platform outage ${phase} phase exited with status ${result.status}.`)
    }
  }

  let primaryError = null
  let fixtureCleanupRequired = false
  try {
    // The setup response can be lost after PostgreSQL commits. From this point
    // onward cleanup is mandatory even when setup appears to fail.
    fixtureCleanupRequired = true
    await runSql(fixtureSetupSql(fixture), 'fixture_setup')
    runPhase('initial')
    if (production) {
      const claim = await runSql(
        preclaimFixtureRetrySql(fixture.profileId),
        'fixture_retry_preclaim',
      )
      const rows = claim?.rows
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        typeof rows[0]?.job_id !== 'string' ||
        rows[0]?.profile_id !== fixture.profileId ||
        rows[0]?.platform !== 'codeforces' ||
        rows[0]?.attempt_count !== 2 ||
        rows[0]?.max_attempts !== 2
      ) {
        throw new Error('Production outage retry preclaim did not return the exact fixture job.')
      }
      runPhase('retry', rows[0].job_id)
    } else {
      await runSql(makeRetryDueSql(fixture.profileId), 'retry_due')
      runPhase('retry')
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    let finalizationError = null
    if (fixtureCleanupRequired) {
      let cleanupError = null
      try {
        await runSql(fixtureCleanupSql(fixture), 'fixture_cleanup')
      } catch (error) {
        cleanupError = error
      }
      if (production) {
        try {
          const audit = await runSql(
            fixtureCleanupAuditSql(fixture.profileId),
            'fixture_cleanup_audit',
          )
          assertFixtureCleanupAudit(audit)
          cleanupError = null
        } catch (auditError) {
          if (cleanupError) cleanupError.message = `${cleanupError.message}\n${auditError.message}`
          else cleanupError = auditError
        }
      }
      if (cleanupError) {
        if (primaryError) primaryError.message = `${primaryError.message}\n${cleanupError.message}`
        else finalizationError = cleanupError
      }
    }
    if (!primaryError && finalizationError) throw finalizationError
  }
}

if (basename(process.argv[1] ?? '') === 'check-sync-platform-outage.mjs') {
  const production = process.argv.includes('--production')
  runSyncPlatformOutageCheck({ production })
    .then(() => {
      console.log(
        JSON.stringify({
          ok: true,
          environment: production ? 'production' : 'local',
          fixtureCleaned: true,
        }),
      )
    })
    .catch((error) => {
      console.error(`Single-platform outage integration check failed: ${error.message}`)
      process.exitCode = 1
    })
}
