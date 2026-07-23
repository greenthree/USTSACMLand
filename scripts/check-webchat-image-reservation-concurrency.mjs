import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = Object.freeze({
  userId: '00000000-0000-4000-8000-00000000c001',
  conversationIds: [
    '00000000-0000-4000-8000-00000000c101',
    '00000000-0000-4000-8000-00000000c102',
    '00000000-0000-4000-8000-00000000c103',
    '00000000-0000-4000-8000-00000000c104',
    '00000000-0000-4000-8000-00000000c105',
  ],
  attachmentA: '00000000-0000-4000-8000-00000000d030',
  attachmentB: '00000000-0000-4000-8000-00000000d031',
})

const expectedRateLimit = /ERROR:\s+54000: WebChat member image upload rate limit reached\./
const maxOutputBytes = 1024 * 1024
const globalConfigKeys = Object.freeze([
  'image_uploads_paused',
  'image_hourly_attachment_limit',
  'image_hourly_original_bytes_limit',
  'image_storage_capacity_bytes',
  'image_max_active_validations',
])

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function findSupabaseDatabaseContainer({
  configured = process.env.SUPABASE_DB_CONTAINER,
  project = process.env.SUPABASE_PROJECT_ID ?? 'usts-acm-land',
  run = execFileSync,
} = {}) {
  if (configured?.trim()) return configured.trim()

  let output
  try {
    output = run(
      'docker',
      ['ps', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 10_000 },
    )
  } catch (error) {
    throw new Error(
      `Could not inspect local Supabase containers. Start Supabase and Docker first. ${error.message}`,
    )
  }

  const candidates = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('supabase_db_'))
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one Supabase database container for project ${project}; found ${candidates.length}. Set SUPABASE_DB_CONTAINER explicitly if needed.`,
    )
  }
  return candidates[0]
}

function createPsqlProcess(container, sql, { applicationName, timeoutMs = 20_000 } = {}) {
  const args = ['exec', '-i']
  if (applicationName) args.push('-e', `PGAPPNAME=${applicationName}`)
  args.push(
    container,
    'psql',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    '--username',
    'postgres',
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
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })

  child.stdin.end(`${sql.trim()}\n`)
  return { child, completed }
}

async function runPsql(container, sql, options) {
  const result = await createPsqlProcess(container, sql, options).completed
  if (result.timedOut) {
    throw new Error(`PostgreSQL check exceeded its ${options?.timeoutMs ?? 20_000} ms timeout.`)
  }
  if (result.code !== 0) {
    throw new Error(
      `PostgreSQL check failed with exit code ${result.code}.\n${result.stderr || result.stdout}`,
    )
  }
  return result.stdout.trim()
}

function activityProbeSql(applicationName, condition) {
  return `
select case when exists (
  select 1
  from pg_catalog.pg_stat_activity
  where application_name = ${quoteLiteral(applicationName)}
    and pid <> pg_catalog.pg_backend_pid()
    and ${condition}
) then 'ready' else 'waiting' end;
`
}

async function waitForActivity(
  container,
  applicationName,
  condition,
  description,
  timeoutMs,
  trackedProcess,
) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    if (trackedProcess?.child.exitCode !== null) {
      const result = await trackedProcess.completed
      throw new Error(
        `Connection exited before ${description} (exit ${result.code}).\n${result.stderr || result.stdout}`,
      )
    }
    try {
      const output = await runPsql(container, activityProbeSql(applicationName, condition), {
        timeoutMs: 3_000,
      })
      if (output.split(/\r?\n/u).at(-1)?.trim() === 'ready') return
      lastError = null
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last probe error: ${lastError.message}` : ''}`,
  )
}

export function assertConcurrentReservationResults({ a, b, verification }) {
  if (a.timedOut || b.timedOut) {
    throw new Error('A concurrent PostgreSQL session exceeded the bounded execution timeout.')
  }
  if (a.code !== 0 || !a.stdout.includes(`A_RESERVED|${fixture.attachmentA}`)) {
    throw new Error(`Connection A did not commit reservation 30.\n${a.stderr || a.stdout}`)
  }
  if (b.code === 0 || !expectedRateLimit.test(b.stderr)) {
    throw new Error(
      `Connection B did not fail reservation 31 with SQLSTATE 54000 after waiting for A.\n${b.stderr || b.stdout}`,
    )
  }
  const expected = `30|1|0`
  if (verification.trim() !== expected) {
    throw new Error(
      `Expected exactly 30 recent reservations with only A present; observed ${verification.trim() || '<empty>'}.`,
    )
  }
}

export function parseGlobalImageConfigSnapshot(source) {
  let snapshot
  try {
    snapshot = JSON.parse(source)
  } catch {
    throw new Error('WebChat global image configuration snapshot is not valid JSON.')
  }
  if (
    snapshot === null ||
    Array.isArray(snapshot) ||
    typeof snapshot !== 'object' ||
    Object.keys(snapshot).length !== globalConfigKeys.length ||
    globalConfigKeys.some((key) => !Object.hasOwn(snapshot, key)) ||
    typeof snapshot.image_uploads_paused !== 'boolean' ||
    !Number.isSafeInteger(snapshot.image_hourly_attachment_limit) ||
    snapshot.image_hourly_attachment_limit < 1 ||
    snapshot.image_hourly_attachment_limit > 10_000 ||
    !Number.isSafeInteger(snapshot.image_hourly_original_bytes_limit) ||
    snapshot.image_hourly_original_bytes_limit < 1 ||
    snapshot.image_hourly_original_bytes_limit > 1_099_511_627_776 ||
    !Number.isSafeInteger(snapshot.image_storage_capacity_bytes) ||
    snapshot.image_storage_capacity_bytes < 1 ||
    snapshot.image_storage_capacity_bytes > 1_099_511_627_776 ||
    !Number.isSafeInteger(snapshot.image_max_active_validations) ||
    snapshot.image_max_active_validations < 1 ||
    snapshot.image_max_active_validations > 100
  ) {
    throw new Error('WebChat global image configuration snapshot is invalid or incomplete.')
  }
  return snapshot
}

function preflightSql() {
  return `
do $$
declare
  wrapper_definition text;
  account_definition text;
begin
  if pg_catalog.to_regclass('private.webchat_image_attachments') is null
    or pg_catalog.to_regclass('private.webchat_image_upload_state') is null
    or pg_catalog.to_regclass('private.webchat_global_quota_state') is null then
    raise exception 'WebChat image abuse-control migrations are not installed.';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'private'
      and tablename = 'webchat_image_attachments'
      and indexname = 'webchat_image_attachments_user_reserved_at_idx'
  ) then
    raise exception 'Rolling reservation index is missing.';
  end if;
  if pg_catalog.to_regprocedure(
    'public.reserve_webchat_image_attachment(uuid,uuid,uuid,text,bigint)'
  ) is null or pg_catalog.to_regprocedure(
    'private.reserve_webchat_image_attachment_without_global_limits(uuid,uuid,uuid,text,bigint)'
  ) is null then
    raise exception 'Global reservation wrapper and its account implementation are required.';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.reserve_webchat_image_attachment(uuid,uuid,uuid,text,bigint)'::pg_catalog.regprocedure
  ) into wrapper_definition;
  if pg_catalog.strpos(wrapper_definition, 'private.webchat_global_quota_state') = 0
    or pg_catalog.strpos(wrapper_definition, 'for update') = 0
    or pg_catalog.strpos(
      wrapper_definition,
      'private.reserve_webchat_image_attachment_without_global_limits'
    ) = 0 then
    raise exception 'Public reservation RPC is not the global-first wrapper.';
  end if;
  select pg_catalog.pg_get_functiondef(
    'private.reserve_webchat_image_attachment_without_global_limits(uuid,uuid,uuid,text,bigint)'::pg_catalog.regprocedure
  ) into account_definition;
  if pg_catalog.strpos(
    account_definition,
    'reserved_at > checked_at - interval ''1 hour'''
  ) = 0 then
    raise exception 'Account reservation implementation does not enforce the rolling one-hour window.';
  end if;
end;
$$;
`
}

function snapshotGlobalConfigSql() {
  return `
select pg_catalog.json_build_object(
  'image_uploads_paused', image_uploads_paused,
  'image_hourly_attachment_limit', image_hourly_attachment_limit,
  'image_hourly_original_bytes_limit', image_hourly_original_bytes_limit,
  'image_storage_capacity_bytes', image_storage_capacity_bytes,
  'image_max_active_validations', image_max_active_validations
)::text
from private.webchat_global_quota_state
where singleton;
`
}

function restoreGlobalConfigSql(snapshot) {
  return `
do $$
begin
  update private.webchat_global_quota_state
  set
    image_uploads_paused = ${snapshot.image_uploads_paused ? 'true' : 'false'},
    image_hourly_attachment_limit = ${snapshot.image_hourly_attachment_limit},
    image_hourly_original_bytes_limit = ${snapshot.image_hourly_original_bytes_limit},
    image_storage_capacity_bytes = ${snapshot.image_storage_capacity_bytes},
    image_max_active_validations = ${snapshot.image_max_active_validations},
    updated_at = pg_catalog.clock_timestamp()
  where singleton;
  if not found then
    raise exception 'WebChat global quota state disappeared before configuration restore.';
  end if;
end;
$$;
`
}

function cleanupSql() {
  return `
begin;
delete from public.profiles where id = ${quoteLiteral(fixture.userId)}::uuid;
set local session_replication_role = 'replica';
delete from auth.users where id = ${quoteLiteral(fixture.userId)}::uuid;
set local session_replication_role = 'origin';
commit;
do $$
begin
  if exists (
    select 1 from private.webchat_image_attachments where user_id = ${quoteLiteral(fixture.userId)}::uuid
  ) or exists (
    select 1 from private.webchat_conversations where user_id = ${quoteLiteral(fixture.userId)}::uuid
  ) or exists (
    select 1 from public.profiles where id = ${quoteLiteral(fixture.userId)}::uuid
  ) then
    raise exception 'Concurrency fixture cleanup was incomplete.';
  end if;
end;
$$;
`
}

function terminateSessionsSql(applicationNames) {
  return `
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name in (${applicationNames.map(quoteLiteral).join(', ')})
  and pid <> pg_catalog.pg_backend_pid();
`
}

function setupSql() {
  const conversationValues = fixture.conversationIds
    .map(
      (id, index) =>
        `(${quoteLiteral(id)}::uuid, ${quoteLiteral(fixture.userId)}::uuid, 'Image concurrency ${index + 1}')`,
    )
    .join(',\n  ')
  return `
begin;
update private.webchat_global_quota_state
set
  image_uploads_paused = false,
  image_hourly_attachment_limit = 10000,
  image_hourly_original_bytes_limit = 1099511627776,
  image_storage_capacity_bytes = 1099511627776,
  image_max_active_validations = 100,
  updated_at = pg_catalog.clock_timestamp()
where singleton;
delete from public.profiles where id = ${quoteLiteral(fixture.userId)}::uuid;
set local session_replication_role = 'replica';
delete from auth.users where id = ${quoteLiteral(fixture.userId)}::uuid;
set local session_replication_role = 'origin';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  ${quoteLiteral(fixture.userId)}::uuid,
  'authenticated', 'authenticated', 'image-concurrency@example.test', 'test-password',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Image Concurrency Fixture"}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
);
update public.profiles
set review_status = 'approved', role = 'member'::public.app_role
where id = ${quoteLiteral(fixture.userId)}::uuid;
insert into private.webchat_conversations (id, user_id, title) values
  ${conversationValues};
with seeded as (
  select
    item,
    (${quoteLiteral('00000000-0000-4000-8000-00000000d')} || pg_catalog.lpad(item::text, 3, '0'))::uuid as attachment_id,
    (${quoteLiteral('00000000-0000-4000-8000-00000000c10')} || (((item - 1) / 8) + 1)::text)::uuid as conversation_id,
    pg_catalog.clock_timestamp() - interval '5 minutes' as reserved_at
  from pg_catalog.generate_series(1, 29) as item
)
insert into private.webchat_image_attachments (
  id, user_id, conversation_id, status, bucket_id, object_key,
  original_mime, original_bytes, reserved_at, expires_at, created_at, updated_at
)
select
  attachment_id,
  ${quoteLiteral(fixture.userId)}::uuid,
  conversation_id,
  'reserved',
  'webchat-images',
  'user/${fixture.userId}/conversation/' || conversation_id::text
    || '/attachment/' || attachment_id::text || '.webp',
  'image/png',
  1,
  reserved_at,
  reserved_at + interval '30 minutes',
  reserved_at,
  reserved_at
from seeded;
commit;
`
}

function reservationSql(label, attachmentId, sleepSeconds = null) {
  return `
\\set VERBOSITY verbose
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
select ${quoteLiteral(`${label}_RESERVED`)} || '|' || id::text
from public.reserve_webchat_image_attachment(
  ${quoteLiteral(fixture.userId)}::uuid,
  ${quoteLiteral(fixture.conversationIds[4])}::uuid,
  ${quoteLiteral(attachmentId)}::uuid,
  'image/png',
  1
);
${sleepSeconds === null ? '' : `select pg_catalog.pg_sleep(${sleepSeconds});`}
commit;
`
}

function verifySql() {
  return `
select
  pg_catalog.count(*) filter (
    where reserved_at > pg_catalog.clock_timestamp() - interval '1 hour'
  )::text
  || '|' || pg_catalog.count(*) filter (where id = ${quoteLiteral(fixture.attachmentA)}::uuid)::text
  || '|' || pg_catalog.count(*) filter (where id = ${quoteLiteral(fixture.attachmentB)}::uuid)::text
from private.webchat_image_attachments
where user_id = ${quoteLiteral(fixture.userId)}::uuid;
`
}

export async function runWebchatImageReservationConcurrencyCheck({
  container = findSupabaseDatabaseContainer(),
  holdSeconds = 6,
} = {}) {
  const runId = `${process.pid}-${Date.now()}`
  const applicationSetup = `webchat-image-concurrency-setup-${runId}`
  const applicationA = `webchat-image-concurrency-a-${runId}`
  const applicationB = `webchat-image-concurrency-b-${runId}`
  const concurrentProcesses = []
  let primaryError = null

  await runPsql(container, preflightSql(), { timeoutMs: 10_000 })
  const globalConfig = parseGlobalImageConfigSnapshot(
    await runPsql(container, snapshotGlobalConfigSql(), { timeoutMs: 5_000 }),
  )
  try {
    await runPsql(container, setupSql(), {
      applicationName: applicationSetup,
      timeoutMs: 10_000,
    })

    const processA = createPsqlProcess(
      container,
      reservationSql('A', fixture.attachmentA, holdSeconds),
      { applicationName: applicationA, timeoutMs: 20_000 },
    )
    concurrentProcesses.push(processA)
    await waitForActivity(
      container,
      applicationA,
      "state = 'active' and wait_event = 'PgSleep'",
      'connection A to reserve item 30 and hold the global-first and per-user locks',
      5_000,
      processA,
    )

    const processB = createPsqlProcess(container, reservationSql('B', fixture.attachmentB), {
      applicationName: applicationB,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(processB)
    await waitForActivity(
      container,
      applicationB,
      "state = 'active' and wait_event_type = 'Lock'",
      'connection B to block on the global-first quota lock behind connection A',
      5_000,
      processB,
    )

    const [a, b] = await Promise.all([processA.completed, processB.completed])
    const verification = await runPsql(container, verifySql(), { timeoutMs: 5_000 })
    assertConcurrentReservationResults({ a, b, verification })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    for (const process of concurrentProcesses) {
      if (process.child.exitCode === null) process.child.kill('SIGKILL')
    }
    await Promise.allSettled(concurrentProcesses.map((process) => process.completed))
    let teardownError = null
    try {
      await runPsql(
        container,
        terminateSessionsSql([applicationSetup, applicationA, applicationB]),
        { timeoutMs: 5_000 },
      )
    } catch (error) {
      teardownError = new Error(`Could not terminate concurrency sessions: ${error.message}`)
    }
    try {
      await runPsql(container, cleanupSql(), { timeoutMs: 10_000 })
    } catch (cleanupError) {
      teardownError = new Error(
        `${teardownError ? `${teardownError.message}\n` : ''}Fixture cleanup failed: ${cleanupError.message}`,
      )
    }
    try {
      await runPsql(container, restoreGlobalConfigSql(globalConfig), { timeoutMs: 5_000 })
    } catch (restoreError) {
      teardownError = new Error(
        `${teardownError ? `${teardownError.message}\n` : ''}Global image configuration restore failed: ${restoreError.message}`,
      )
    }
    if (teardownError && primaryError) {
      primaryError.message = `${primaryError.message}\n${teardownError.message}`
    } else if (teardownError) {
      throw teardownError
    }
  }
  return { container, recentReservations: 30 }
}

async function main() {
  const result = await runWebchatImageReservationConcurrencyCheck()
  console.log(
    `Verified WebChat image rolling limit in ${result.container}: connection B waited on A's global-first quota lock, reservation 31 was rejected by the account rolling limit, and exactly ${result.recentReservations} recent rows remained before cleanup.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`WebChat image concurrency check failed: ${error.message}`)
    process.exitCode = 1
  })
}
