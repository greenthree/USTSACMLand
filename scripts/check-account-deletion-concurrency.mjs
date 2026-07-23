import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = Object.freeze({
  userId: '00000000-0000-4000-8000-00000000de10',
  ownerToken: '00000000-0000-4000-8000-00000000de11',
  bucketId: 'account-deletion-concurrency',
  storageObjectId: '00000000-0000-4000-8000-00000000de12',
})

const maxOutputBytes = 1024 * 1024

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
  return {
    child,
    completed,
    getStdout: () => stdout,
    getStderr: () => stderr,
  }
}

export async function runPsql(container, sql, options) {
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

async function waitForBlockedConnection(container, applicationName, trackedProcess, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (trackedProcess.child.exitCode !== null) {
      const result = await trackedProcess.completed
      throw new Error(
        `Connection B exited before waiting on the deletion fence (exit ${result.code}).\n${result.stderr || result.stdout}`,
      )
    }
    const output = await runPsql(
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
    if (output.split(/\r?\n/u).at(-1)?.trim() === 'blocked') return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error('Timed out waiting for connection B to block on the deletion fence.')
}

async function waitForProcessOutput(trackedProcess, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (trackedProcess.getStdout().includes(expected)) return
    if (trackedProcess.child.exitCode !== null) {
      const result = await trackedProcess.completed
      throw new Error(
        `Connection exited before producing ${expected}: ${result.stderr || result.stdout}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for connection output ${expected}.`)
}

export function assertAccountDeletionConcurrencyResults({ a, b, verification }) {
  if (a.timedOut || b.timedOut) {
    throw new Error('A concurrent PostgreSQL session exceeded the bounded execution timeout.')
  }
  if (a.code !== 0 || !a.stdout.includes('A|true|true')) {
    throw new Error(`Connection A did not commit the fenced deletion.\n${a.stderr || a.stdout}`)
  }
  if (b.code !== 0 || !b.stdout.includes('B|false|false')) {
    throw new Error(
      `Connection B did not observe the consumed lease after waiting for A.\n${b.stderr || b.stdout}`,
    )
  }
  if (verification.trim() !== '0|0|0') {
    throw new Error(
      `Expected Auth, Profile, and recovery lease rows to be absent; observed ${verification.trim() || '<empty>'}.`,
    )
  }
}

function cleanupSql() {
  return `
begin;
set local session_replication_role = 'replica';
delete from storage.objects
where bucket_id = ${quoteLiteral(fixture.bucketId)};
delete from storage.buckets
where id = ${quoteLiteral(fixture.bucketId)};
set local session_replication_role = 'origin';
delete from private.account_deletion_recovery_lease
where target_user_id = ${quoteLiteral(fixture.userId)}::uuid;
delete from public.profiles where id = ${quoteLiteral(fixture.userId)}::uuid;
set local session_replication_role = 'replica';
delete from auth.users where id = ${quoteLiteral(fixture.userId)}::uuid;
set local session_replication_role = 'origin';
commit;
`
}

function preflightSql() {
  return `
do $$
begin
  if pg_catalog.to_regclass('private.account_deletion_recovery_lease') is null
    or pg_catalog.to_regprocedure(
      'public.delete_auth_user_with_recovery_lease(uuid,uuid)'
    ) is null then
    raise exception 'Account-deletion fencing migration is not installed.';
  end if;
end;
$$;
`
}

function setupSql() {
  return `
begin;
set local statement_timeout = '10s';
lock table private.account_deletion_recovery_lease in share row exclusive mode;
do $$
begin
  if exists (select 1 from private.account_deletion_recovery_lease) then
    raise exception 'A recovery lease already exists; refusing to disturb local account deletion state.';
  end if;
end;
$$;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  ${quoteLiteral(fixture.userId)}::uuid,
  'authenticated', 'authenticated', 'deletion-concurrency@example.test', 'test-password',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Deletion Concurrency Fixture"}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
);
update public.profiles
set review_status = 'approved', role = 'member'::public.app_role
where id = ${quoteLiteral(fixture.userId)}::uuid;
insert into storage.buckets (id, name, public)
values (${quoteLiteral(fixture.bucketId)}, ${quoteLiteral(fixture.bucketId)}, false);
do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    ${quoteLiteral(fixture.ownerToken)}::uuid,
    ${quoteLiteral(fixture.userId)}::uuid
  ) then
    raise exception 'Could not acquire the fixture recovery lease.';
  end if;
end;
$$;
commit;
`
}

function deletionSql(label, holdSeconds = null) {
  return `
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
select ${quoteLiteral(`${label}|`)}
  || (result ->> 'leaseOwned') || '|'
  || (result ->> 'deleted')
from (
  select public.delete_auth_user_with_recovery_lease(
    ${quoteLiteral(fixture.ownerToken)}::uuid,
    ${quoteLiteral(fixture.userId)}::uuid
  ) as result
) as deletion;
${holdSeconds === null ? '' : `select pg_catalog.pg_sleep(${holdSeconds});`}
commit;
`
}

function verificationSql() {
  return `
select
  (select pg_catalog.count(*) from auth.users
   where id = ${quoteLiteral(fixture.userId)}::uuid)::text
  || '|' ||
  (select pg_catalog.count(*) from public.profiles
   where id = ${quoteLiteral(fixture.userId)}::uuid)::text
  || '|' ||
  (select pg_catalog.count(*) from private.account_deletion_recovery_lease
   where target_user_id = ${quoteLiteral(fixture.userId)}::uuid)::text;
`
}

function storageInsertSql() {
  return `
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
insert into storage.objects (id, bucket_id, name, owner_id, metadata)
values (
  ${quoteLiteral(fixture.storageObjectId)}::uuid,
  ${quoteLiteral(fixture.bucketId)},
  'concurrent-owner.webp',
  ${quoteLiteral(fixture.userId)},
  '{"mimetype":"image/webp"}'::jsonb
);
select 'U|inserted';
select pg_catalog.pg_sleep(5);
commit;
`
}

function storageVerificationSql() {
  return `
select
  (select pg_catalog.count(*) from auth.users
   where id = ${quoteLiteral(fixture.userId)}::uuid)::text
  || '|' ||
  (select pg_catalog.count(*) from public.profiles
   where id = ${quoteLiteral(fixture.userId)}::uuid)::text
  || '|' ||
  (select pg_catalog.count(*) from private.account_deletion_recovery_lease
   where target_user_id = ${quoteLiteral(fixture.userId)}::uuid)::text
  || '|' ||
  (select pg_catalog.count(*) from storage.objects
   where id = ${quoteLiteral(fixture.storageObjectId)}::uuid)::text;
`
}

function storageDeletionSql() {
  return `
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
select 'D|' || (result ->> 'leaseOwned') || '|' || (result ->> 'deleted')
from (
  select public.delete_auth_user_with_recovery_lease(
    ${quoteLiteral(fixture.ownerToken)}::uuid,
    ${quoteLiteral(fixture.userId)}::uuid
  ) as result
) as deletion;
select pg_catalog.pg_sleep(5);
commit;
`
}

export function assertStorageUploadThenDeleteResults({ upload, deletion, verification }) {
  if (upload.timedOut || deletion.timedOut) {
    throw new Error('A concurrent Storage/Auth session exceeded the bounded execution timeout.')
  }
  if (upload.code !== 0 || !upload.stdout.includes('U|inserted')) {
    throw new Error(
      `Storage upload did not commit before deletion.\n${upload.stderr || upload.stdout}`,
    )
  }
  if (deletion.code !== 0 || !deletion.stdout.includes('D|true|false')) {
    throw new Error(
      `Deletion did not preserve the account while Storage was owned.\n${deletion.stderr || deletion.stdout}`,
    )
  }
  if (verification.trim() !== '1|1|1|1') {
    throw new Error(
      `Expected Auth, Profile, lease, and Storage rows to remain; observed ${verification.trim() || '<empty>'}.`,
    )
  }
}

export function assertStorageDeleteThenUploadResults({ deletion, upload, verification }) {
  if (deletion.timedOut || upload.timedOut) {
    throw new Error('A concurrent Auth/Storage session exceeded the bounded execution timeout.')
  }
  if (deletion.code !== 0 || !deletion.stdout.includes('D|true|true')) {
    throw new Error(
      `Deletion did not commit before the Storage upload.\n${deletion.stderr || deletion.stdout}`,
    )
  }
  if (
    upload.code === 0 ||
    !upload.stderr.includes('Storage object ownership requires a live Auth user.')
  ) {
    throw new Error(
      `Storage upload was not rejected after Auth deletion.\n${upload.stderr || upload.stdout}`,
    )
  }
  if (verification.trim() !== '0|0|0|0') {
    throw new Error(
      `Expected Auth, Profile, lease, and Storage rows to be absent; observed ${verification.trim() || '<empty>'}.`,
    )
  }
}

function terminateSessionsSql(applicationNames) {
  return `
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name in (${applicationNames.map(quoteLiteral).join(', ')})
  and pid <> pg_catalog.pg_backend_pid();
`
}

export async function runAccountDeletionConcurrencyCheck({
  container = findSupabaseDatabaseContainer(),
  holdSeconds = 5,
} = {}) {
  const runId = `${process.pid}-${Date.now()}`
  const applicationA = `account-deletion-concurrency-a-${runId}`
  const applicationB = `account-deletion-concurrency-b-${runId}`
  const applicationC = `account-deletion-storage-c-${runId}`
  const applicationD = `account-deletion-storage-d-${runId}`
  const applicationE = `account-deletion-storage-e-${runId}`
  const applicationF = `account-deletion-storage-f-${runId}`
  const concurrentProcesses = []
  let primaryError = null

  await runPsql(container, preflightSql(), { timeoutMs: 10_000 })
  await runPsql(container, cleanupSql(), { timeoutMs: 10_000 })
  try {
    await runPsql(container, setupSql(), { timeoutMs: 10_000 })
    const processA = createPsqlProcess(container, deletionSql('A', holdSeconds), {
      applicationName: applicationA,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(processA)
    await new Promise((resolve) => setTimeout(resolve, 250))

    const processB = createPsqlProcess(container, deletionSql('B'), {
      applicationName: applicationB,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(processB)
    await waitForBlockedConnection(container, applicationB, processB, 5_000)

    const [a, b] = await Promise.all([processA.completed, processB.completed])
    const verification = await runPsql(container, verificationSql(), { timeoutMs: 5_000 })
    assertAccountDeletionConcurrencyResults({ a, b, verification })

    await runPsql(container, cleanupSql(), { timeoutMs: 10_000 })
    await runPsql(container, setupSql(), { timeoutMs: 10_000 })
    const uploadFirst = createPsqlProcess(container, storageInsertSql(), {
      applicationName: applicationC,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(uploadFirst)
    await waitForProcessOutput(uploadFirst, 'U|inserted', 5_000)
    const deletionAfterUpload = createPsqlProcess(container, storageDeletionSql(), {
      applicationName: applicationD,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(deletionAfterUpload)
    await waitForBlockedConnection(container, applicationD, deletionAfterUpload, 5_000)
    const [uploadResult, deletionResult] = await Promise.all([
      uploadFirst.completed,
      deletionAfterUpload.completed,
    ])
    const uploadFirstVerification = await runPsql(container, storageVerificationSql(), {
      timeoutMs: 5_000,
    })
    assertStorageUploadThenDeleteResults({
      upload: uploadResult,
      deletion: deletionResult,
      verification: uploadFirstVerification,
    })

    await runPsql(container, cleanupSql(), { timeoutMs: 10_000 })
    await runPsql(container, setupSql(), { timeoutMs: 10_000 })
    const deleteFirst = createPsqlProcess(container, storageDeletionSql(), {
      applicationName: applicationE,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(deleteFirst)
    await waitForProcessOutput(deleteFirst, 'D|true|true', 5_000)
    const uploadAfterDelete = createPsqlProcess(container, storageInsertSql(), {
      applicationName: applicationF,
      timeoutMs: 20_000,
    })
    concurrentProcesses.push(uploadAfterDelete)
    await waitForBlockedConnection(container, applicationF, uploadAfterDelete, 5_000)
    const [deleteResult, uploadResultAfterDelete] = await Promise.all([
      deleteFirst.completed,
      uploadAfterDelete.completed,
    ])
    const deleteFirstVerification = await runPsql(container, storageVerificationSql(), {
      timeoutMs: 5_000,
    })
    assertStorageDeleteThenUploadResults({
      deletion: deleteResult,
      upload: uploadResultAfterDelete,
      verification: deleteFirstVerification,
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    for (const process of concurrentProcesses) {
      if (process.child.exitCode === null) process.child.kill('SIGKILL')
    }
    await Promise.allSettled(concurrentProcesses.map((process) => process.completed))
    let cleanupError = null
    try {
      await runPsql(
        container,
        terminateSessionsSql([
          applicationA,
          applicationB,
          applicationC,
          applicationD,
          applicationE,
          applicationF,
        ]),
        {
          timeoutMs: 5_000,
        },
      )
      await runPsql(container, cleanupSql(), { timeoutMs: 10_000 })
    } catch (error) {
      cleanupError = new Error(`Account-deletion fixture cleanup failed: ${error.message}`)
    }
    if (cleanupError && primaryError)
      primaryError.message = `${primaryError.message}\n${cleanupError.message}`
    else if (cleanupError) throw cleanupError
  }

  return { container }
}

async function main() {
  const result = await runAccountDeletionConcurrencyCheck()
  console.log(
    `Verified account-deletion fencing in ${result.container}: competing deletions, upload-before-delete, and delete-before-upload all preserved atomic Auth/Profile/lease/Storage state.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Account-deletion concurrency check failed: ${error.message}`)
    process.exitCode = 1
  })
}
