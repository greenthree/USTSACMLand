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

export function buildDenoArguments() {
  return [
    'test',
    '--config=supabase/functions/deno.json',
    '--allow-env=ANON_KEY,API_URL,SERVICE_ROLE_KEY,SYNC_OUTAGE_PHASE,SYNC_OUTAGE_PROFILE_ID,SYNC_OUTAGE_SUFFIX,SYNC_OUTAGE_OBSERVED_AT',
    '--allow-net=127.0.0.1:54321,localhost:54321',
    integrationTest,
  ]
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

function makeRetryDueSql(profileId) {
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

export async function runSyncPlatformOutageCheck({
  platform = process.platform,
  execFile = execFileSync,
  spawn = spawnSync,
} = {}) {
  const npx = platform === 'win32' ? process.execPath : 'npx'
  const npxPrefix =
    platform === 'win32'
      ? [resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')]
      : []
  const statusOutput = execFile(
    npx,
    [...npxPrefix, '--yes', 'supabase@2.109.1', 'status', '-o', 'env'],
    { encoding: 'utf8' },
  )
  const localEnvironment = parseSupabaseStatusEnv(statusOutput)
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  const fixture = {
    profileId: randomUUID(),
    ownerToken: randomUUID(),
    suffix,
    email: `sync-outage-${suffix}@example.test`,
    observedAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
    staleAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
  }
  const container = findSupabaseDatabaseContainer()
  const denoCommandName = platform === 'win32' ? 'deno.exe' : 'deno'
  const denoAvailable = spawn(denoCommandName, ['--version'], { stdio: 'ignore' }).status === 0
  const denoCommand = denoAvailable ? denoCommandName : npx
  const denoArguments = denoAvailable
    ? buildDenoArguments()
    : [...npxPrefix, '--yes', 'deno@2.5.6', ...buildDenoArguments()]
  const runPhase = (phase) => {
    const result = spawn(denoCommand, denoArguments, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...localEnvironment,
        SYNC_OUTAGE_PHASE: phase,
        SYNC_OUTAGE_PROFILE_ID: fixture.profileId,
        SYNC_OUTAGE_SUFFIX: fixture.suffix,
        SYNC_OUTAGE_OBSERVED_AT: fixture.observedAt,
      },
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Single-platform outage ${phase} phase exited with status ${result.status}.`)
    }
  }

  let primaryError = null
  try {
    await runPsql(container, fixtureSetupSql(fixture), { timeoutMs: 10_000 })
    runPhase('initial')
    await runPsql(container, makeRetryDueSql(fixture.profileId), { timeoutMs: 10_000 })
    runPhase('retry')
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await runPsql(container, fixtureCleanupSql(fixture), { timeoutMs: 10_000 })
    } catch (cleanupError) {
      if (primaryError) primaryError.message = `${primaryError.message}\n${cleanupError.message}`
      else throw cleanupError
    }
  }
}

if (basename(process.argv[1] ?? '') === 'check-sync-platform-outage.mjs') {
  runSyncPlatformOutageCheck().catch((error) => {
    console.error(`Single-platform outage integration check failed: ${error.message}`)
    process.exitCode = 1
  })
}
