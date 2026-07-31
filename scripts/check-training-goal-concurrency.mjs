import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixtureId = '00000000-0000-4000-8000-00000000a020'
const defaultProject = 'usts-acm-land'
const maxOutputBytes = 1024 * 1024

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function findLocalDatabaseContainer({
  project = process.env.SUPABASE_PROJECT_ID ?? defaultProject,
  configured = process.env.SUPABASE_DB_CONTAINER,
  run = execFileSync,
} = {}) {
  const candidates = configured?.trim()
    ? [configured.trim()]
    : run(
        'docker',
        ['ps', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.Names}}'],
        { encoding: 'utf8', timeout: 10_000 },
      )
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('supabase_db_'))

  if (candidates.length !== 1 || !/^supabase_db_[A-Za-z0-9_.-]+$/u.test(candidates[0])) {
    throw new Error(
      `Expected exactly one local Supabase database container; found ${candidates.length}.`,
    )
  }

  const state = run(
    'docker',
    [
      'inspect',
      '--format',
      '{{index .Config.Labels "com.supabase.cli.project"}}|{{.State.Running}}',
      candidates[0],
    ],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim()
  if (state !== `${project}|true`) {
    throw new Error(`${candidates[0]} is not the running local database for project ${project}.`)
  }
  return candidates[0]
}

function createPsqlProcess(
  container,
  sql,
  { applicationName, timeoutMs = 20_000, username = 'postgres' } = {},
) {
  const args = ['exec', '-i']
  if (applicationName) args.push('-e', `PGAPPNAME=${applicationName}`)
  if (username !== 'postgres') args.push('-e', 'PGPASSWORD=postgres')
  args.push(
    container,
    'psql',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    ...(username === 'postgres' ? [] : ['--host', '127.0.0.1']),
    '--username',
    username,
    '--dbname',
    'postgres',
    '--quiet',
    '--tuples-only',
    '--no-align',
  )

  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const collect = (target) => (chunk) => {
    const next = chunk.toString('utf8')
    if (target === 'stdout') stdout = `${stdout}${next}`.slice(-maxOutputBytes)
    else stderr = `${stderr}${next}`.slice(-maxOutputBytes)
  }
  child.stdout.on('data', collect('stdout'))
  child.stderr.on('data', collect('stderr'))

  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)
  timer.unref()

  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
  child.stdin.end(`${sql.trim()}\n`)
  return { child, completed, getStdout: () => stdout }
}

async function runPsql(container, sql, options) {
  const result = await createPsqlProcess(container, sql, options).completed
  if (result.timedOut || result.code !== 0) {
    throw new Error(`PostgreSQL command failed.\n${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

async function waitForOutput(process, expected, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process.getStdout().includes(expected)) return
    if (process.child.exitCode !== null) {
      const result = await process.completed
      throw new Error(`Connection exited before ${expected}.\n${result.stderr || result.stdout}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${expected}.`)
}

async function waitForBlockedConnection(container, applicationName, process, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      const result = await process.completed
      throw new Error(
        `Contending connection exited before blocking.\n${result.stderr || result.stdout}`,
      )
    }
    const state = await runPsql(
      container,
      `
select case when exists (
  select 1
  from pg_catalog.pg_stat_activity
  where application_name = ${quoteLiteral(applicationName)}
    and pid <> pg_catalog.pg_backend_pid()
    and state = 'active'
    and wait_event_type = 'Lock'
) then 'blocked' else 'pending' end;
`,
      { timeoutMs: 3_000 },
    )
    if (state.split(/\r?\n/u).at(-1)?.trim() === 'blocked') return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error('Timed out waiting for the second create to block on the member quota lock.')
}

function cleanupProfileSql() {
  return `
begin;
delete from public.profiles where id = ${quoteLiteral(fixtureId)}::uuid;
commit;
`
}

function cleanupAuthSql() {
  return `
begin;
alter table auth.users disable trigger user;
delete from auth.users where id = ${quoteLiteral(fixtureId)}::uuid;
alter table auth.users enable trigger user;
commit;
`
}

function setupSql() {
  return `
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  ${quoteLiteral(fixtureId)}::uuid,
  'authenticated', 'authenticated', 'training-goal-concurrency@example.test',
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Training Goal Concurrency"}'::jsonb,
  now(), now(), '', '', '', ''
);

update public.profiles
set full_name = 'Training Goal Concurrency',
    qq = '13900000020',
    grade = '24级',
    major = '计算机科学与技术',
    review_status = 'approved',
    approved_at = now()
where id = ${quoteLiteral(fixtureId)}::uuid;

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
) values (
  ${quoteLiteral(fixtureId)}::uuid, 'codeforces',
  'TrainingGoalConcurrency', 'traininggoalconcurrency', 'verified', now()
);

do $setup$
declare
  saved_job_id bigint;
  saved_run_id bigint;
begin
  insert into public.sync_jobs (
    scope, profile_id, platform, status, trigger_type, attempt_count,
    max_attempts, scheduled_for, started_at, finished_at
  ) values (
    'account', ${quoteLiteral(fixtureId)}::uuid, 'codeforces', 'succeeded',
    'manual', 1, 2, now(), now(), now()
  ) returning id into saved_job_id;

  insert into public.sync_runs (
    job_id, profile_id, platform, attempt, status, started_at, finished_at, source_version
  ) values (
    saved_job_id, ${quoteLiteral(fixtureId)}::uuid, 'codeforces', 1,
    'succeeded', now() - interval '1 second', now(), 'training-goal-concurrency'
  ) returning id into saved_run_id;

  insert into public.stat_snapshots (
    profile_id, platform, sync_run_id, solved_count, status, recorded_at
  ) values (
    ${quoteLiteral(fixtureId)}::uuid, 'codeforces', saved_run_id, 100, 'fresh', now()
  );
end;
$setup$;

insert into public.training_goals (
  profile_id, title, metric, baseline_value, baseline_components,
  target_value, start_date, end_date
)
select
  ${quoteLiteral(fixtureId)}::uuid,
  'Existing goal ' || series,
  'total_solved', 100, '{"codeforces":100}'::jsonb,
  200, current_date, current_date + 30
from generate_series(1, 19) as series;
`
}

async function cleanupFixture(container) {
  await runPsql(container, cleanupProfileSql(), { timeoutMs: 10_000 })
  await runPsql(container, cleanupAuthSql(), {
    timeoutMs: 10_000,
    username: 'supabase_auth_admin',
  })
}

function memberSessionPrefix() {
  return `
set local role authenticated;
select set_config('request.jwt.claim.sub', ${quoteLiteral(fixtureId)}, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
`
}

function firstCreateSql() {
  return `
begin;
${memberSessionPrefix()}
select goal_id from public.create_own_training_goal(
  'Concurrent winner', 'total_solved', null, 1,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 30
);
select 'A_READY';
select pg_catalog.pg_sleep(4);
commit;
select 'A_COMMITTED';
`
}

function secondCreateSql() {
  return `
begin;
${memberSessionPrefix()}
do $check$
declare
  failure_message text;
begin
  perform * from public.create_own_training_goal(
    'Concurrent loser', 'total_solved', null, 1,
    (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 30
  );
  raise exception 'Concurrent create unexpectedly succeeded.';
exception
  when sqlstate '54000' then
    get stacked diagnostics failure_message = message_text;
    if failure_message <> 'Archive an existing goal before creating another one.' then
      raise exception 'Unexpected quota failure: %', failure_message;
    end if;
end;
$check$;
commit;
select 'B_REJECTED';
`
}

export function assertConcurrencyResult({ first, second, verification }) {
  if (first.timedOut || first.code !== 0 || !first.stdout.includes('A_COMMITTED')) {
    throw new Error(`The first create did not commit.\n${first.stderr || first.stdout}`)
  }
  if (second.timedOut || second.code !== 0 || !second.stdout.includes('B_REJECTED')) {
    throw new Error(
      `The second create was not rejected by the quota.\n${second.stderr || second.stdout}`,
    )
  }
  if (verification.trim() !== '20|1|0') {
    throw new Error(
      `Expected 20 active goals with only the winner inserted; observed ${verification}.`,
    )
  }
}

export async function runTrainingGoalConcurrencyCheck() {
  const container = findLocalDatabaseContainer()
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const secondApplication = `training-goal-second-${runId}`
  let primaryError

  try {
    await cleanupFixture(container)
    await runPsql(container, setupSql(), { timeoutMs: 15_000 })
    const first = createPsqlProcess(container, firstCreateSql(), {
      applicationName: `training-goal-first-${runId}`,
      timeoutMs: 15_000,
    })
    await waitForOutput(first, 'A_READY')
    const second = createPsqlProcess(container, secondCreateSql(), {
      applicationName: secondApplication,
      timeoutMs: 15_000,
    })
    await waitForBlockedConnection(container, secondApplication, second)

    const [firstResult, secondResult] = await Promise.all([first.completed, second.completed])
    const verification = await runPsql(
      container,
      `
select
  count(*) filter (where status = 'active') || '|' ||
  count(*) filter (where title = 'Concurrent winner') || '|' ||
  count(*) filter (where title = 'Concurrent loser')
from public.training_goals
where profile_id = ${quoteLiteral(fixtureId)}::uuid;
`,
      { timeoutMs: 5_000 },
    )
    assertConcurrencyResult({ first: firstResult, second: secondResult, verification })
  } catch (error) {
    primaryError = error
  } finally {
    try {
      await cleanupFixture(container)
    } catch (cleanupError) {
      primaryError = primaryError
        ? new Error(`${primaryError.message}\nCleanup failed: ${cleanupError.message}`)
        : cleanupError
    }
  }

  if (primaryError) throw primaryError
  return { container }
}

async function main() {
  const result = await runTrainingGoalConcurrencyCheck()
  console.log(
    `Verified training-goal concurrency in ${result.container}: the second same-member create waited for the transaction lock, retained the existing quota error, and the committed active count remained 20 with zero fixture residue.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Training-goal concurrency check failed: ${error.message}`)
    process.exitCode = 1
  })
}
