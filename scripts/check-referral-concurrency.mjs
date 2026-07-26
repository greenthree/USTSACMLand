import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = Object.freeze({
  adminId: '00000000-0000-4000-8000-00000000c001',
  closeOwnerId: '00000000-0000-4000-8000-00000000c002',
  confirmBeforeCloseId: '00000000-0000-4000-8000-00000000c003',
  confirmAfterCloseId: '00000000-0000-4000-8000-00000000c004',
  limitOwnerId: '00000000-0000-4000-8000-00000000c005',
  tenthWinnerId: '00000000-0000-4000-8000-00000000c006',
  eleventhContenderId: '00000000-0000-4000-8000-00000000c007',
})

const fixtureUsers = Object.freeze([
  [fixture.adminId, 'referral-concurrency-admin@example.test', 'Referral Concurrency Admin'],
  [fixture.closeOwnerId, 'referral-concurrency-close-owner@example.test', 'Referral Close Owner'],
  [
    fixture.confirmBeforeCloseId,
    'referral-concurrency-before@example.test',
    'Referral Before Close',
  ],
  [fixture.confirmAfterCloseId, 'referral-concurrency-after@example.test', 'Referral After Close'],
  [fixture.limitOwnerId, 'referral-concurrency-limit-owner@example.test', 'Referral Limit Owner'],
  [fixture.tenthWinnerId, 'referral-concurrency-tenth@example.test', 'Referral Tenth Winner'],
  [
    fixture.eleventhContenderId,
    'referral-concurrency-eleventh@example.test',
    'Referral Eleventh Contender',
  ],
])

const fixtureIds = fixtureUsers.map(([id]) => id)
const maxOutputBytes = 1024 * 1024
const advisoryLockKey = 7_207_261_361
const defaultProject = 'usts-acm-land'
const supportedLockRelations = new Set([
  'private.referral_program_config',
  'private.referral_codes',
])

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function uuidList(values = fixtureIds) {
  return values.map((value) => `${quoteLiteral(value)}::uuid`).join(', ')
}

function outputLine(output, prefix) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix))
}

export function findLocalSupabaseDatabaseContainer({
  configured = process.env.SUPABASE_DB_CONTAINER,
  project = process.env.SUPABASE_PROJECT_ID ?? defaultProject,
  run = execFileSync,
} = {}) {
  if (configured?.trim()) {
    const candidate = configured.trim()
    if (!/^supabase_db_[A-Za-z0-9_.-]+$/u.test(candidate)) {
      throw new Error('SUPABASE_DB_CONTAINER must name a local Supabase database container.')
    }
    assertLocalSupabaseContainer(candidate, { expectedProject: project, run })
    return candidate
  }

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
      `Expected exactly one local Supabase database container for project ${project}; found ${candidates.length}. Set SUPABASE_DB_CONTAINER explicitly if needed.`,
    )
  }
  assertLocalSupabaseContainer(candidates[0], { expectedProject: project, run })
  return candidates[0]
}

export function assertLocalSupabaseContainer(
  container,
  { expectedProject = process.env.SUPABASE_PROJECT_ID ?? defaultProject, run = execFileSync } = {},
) {
  let output
  try {
    output = run(
      'docker',
      [
        'inspect',
        '--format',
        '{{index .Config.Labels "com.supabase.cli.project"}}|{{.State.Running}}',
        container,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim()
  } catch (error) {
    throw new Error(`Could not inspect ${container}. ${error.message}`)
  }

  const [project, running, extra] = output.split('|')
  if (!project || project !== expectedProject || running !== 'true' || extra !== undefined) {
    throw new Error(`${container} is not a running local Supabase database container.`)
  }
  return project
}

export function referralConcurrencyApplicationNames(runId) {
  return Object.freeze({
    guard: `referral-concurrency-guard-${runId}`,
    confirmFirst: `referral-confirm-first-${runId}`,
    pauseAfter: `referral-pause-after-${runId}`,
    replay: `referral-replay-${runId}`,
    pauseFirst: `referral-pause-first-${runId}`,
    confirmAfter: `referral-confirm-after-${runId}`,
    tenth: `referral-tenth-${runId}`,
    eleventh: `referral-eleventh-${runId}`,
  })
}

export function referralConcurrencyOwnership(runId) {
  const marker = `local-referral-concurrency:${runId}`
  return Object.freeze({
    marker,
    blockReason: `${marker}:reopen-gate`,
    setupReason: `${marker}:setup`,
    firstPauseReason: `${marker}:pause-after-confirmation`,
    secondPreparationReason: `${marker}:prepare-pause-before-confirmation`,
    secondPauseReason: `${marker}:pause-before-confirmation`,
    rewardPreparationReason: `${marker}:prepare-tenth-reward-race`,
  })
}

function sameConfig(left, right) {
  return (
    left.enabled === right.enabled &&
    Number(left.version) === Number(right.version) &&
    left.updated_at === right.updated_at &&
    left.updated_by === right.updated_by &&
    left.change_reason === right.change_reason &&
    left.reopen_allowed === right.reopen_allowed &&
    left.reopen_block_reason === right.reopen_block_reason
  )
}

function ownedConfigPhases(ownership) {
  return {
    setup: {
      enabled: true,
      version: 0,
      updated_by: null,
      change_reason: ownership.setupReason,
    },
    firstPause: {
      enabled: false,
      version: 1,
      updated_by: fixture.adminId,
      change_reason: ownership.firstPauseReason,
    },
    secondPreparation: {
      enabled: true,
      version: 10,
      updated_by: null,
      change_reason: ownership.secondPreparationReason,
    },
    secondPause: {
      enabled: false,
      version: 11,
      updated_by: fixture.adminId,
      change_reason: ownership.secondPauseReason,
    },
    rewardPreparation: {
      enabled: true,
      version: 20,
      updated_by: null,
      change_reason: ownership.rewardPreparationReason,
    },
  }
}

export function isExpectedReferralOwnedPhase(current, ownership, phaseName) {
  const phase = ownedConfigPhases(ownership)[phaseName]
  if (!phase) throw new Error(`Unknown referral checker phase: ${phaseName}.`)
  return (
    current.enabled === phase.enabled &&
    Number(current.version) === phase.version &&
    current.updated_by === phase.updated_by &&
    current.change_reason === phase.change_reason &&
    current.reopen_allowed === true &&
    current.reopen_block_reason === ownership.blockReason
  )
}

export function planReferralConfigCleanup({ current, original, ownership }) {
  if (sameConfig(current, original)) {
    return {
      classification: 'already_restored',
      restoreConfig: false,
      continueFixtureCleanup: true,
    }
  }

  const owned =
    current.reopen_allowed === true &&
    current.reopen_block_reason === ownership.blockReason &&
    Object.values(ownedConfigPhases(ownership)).some(
      (phase) =>
        current.enabled === phase.enabled &&
        Number(current.version) === phase.version &&
        current.updated_by === phase.updated_by &&
        current.change_reason === phase.change_reason,
    )

  return owned
    ? { classification: 'owned', restoreConfig: true, continueFixtureCleanup: true }
    : { classification: 'external', restoreConfig: false, continueFixtureCleanup: true }
}

function createPsqlProcess(container, sql, { applicationName, timeoutMs = 25_000 } = {}) {
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

async function runPsql(container, sql, options) {
  const result = await createPsqlProcess(container, sql, options).completed
  if (result.timedOut) {
    throw new Error(`PostgreSQL check exceeded its ${options?.timeoutMs ?? 25_000} ms timeout.`)
  }
  if (result.code !== 0) {
    throw new Error(
      `PostgreSQL check failed with exit code ${result.code}.\n${result.stderr || result.stdout}`,
    )
  }
  return result.stdout.trim()
}

async function readReferralConfig(container) {
  return parseConfigSnapshot(await runPsql(container, configSnapshotSql(), { timeoutMs: 5_000 }))
}

async function waitForProcessOutput(trackedProcess, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (trackedProcess.getStdout().includes(expected)) return
    if (trackedProcess.child.exitCode !== null) {
      const result = await trackedProcess.completed
      throw new Error(
        `Connection exited before producing ${expected}.\n${result.stderr || result.stdout}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for connection output ${expected}.`)
}

export function referralBlockingProbeSql({
  waiterApplication,
  blockerApplication,
  targetRelation,
}) {
  if (!supportedLockRelations.has(targetRelation)) {
    throw new Error(`Unsupported referral lock relation: ${targetRelation}.`)
  }
  return `
with waiter as (
  select activity.pid
  from pg_catalog.pg_stat_activity as activity
  where activity.application_name = ${quoteLiteral(waiterApplication)}
    and activity.pid <> pg_catalog.pg_backend_pid()
    and activity.state = 'active'
), blocker as (
  select waiter.pid as waiter_pid, blocker_pid
  from waiter
  cross join lateral pg_catalog.unnest(
    pg_catalog.pg_blocking_pids(waiter.pid)
  ) as blocked_by(blocker_pid)
)
select case when exists (
  select 1
  from blocker
  join pg_catalog.pg_stat_activity as blocker_activity
    on blocker_activity.pid = blocker.blocker_pid
   and blocker_activity.application_name = ${quoteLiteral(blockerApplication)}
  join pg_catalog.pg_locks as waiting_lock
    on waiting_lock.pid = blocker.waiter_pid
   and not waiting_lock.granted
  join pg_catalog.pg_locks as blocking_lock
    on blocking_lock.pid = blocker.blocker_pid
   and blocking_lock.granted
   and blocking_lock.locktype = waiting_lock.locktype
   and blocking_lock.database is not distinct from waiting_lock.database
   and blocking_lock.relation is not distinct from waiting_lock.relation
   and blocking_lock.page is not distinct from waiting_lock.page
   and blocking_lock.tuple is not distinct from waiting_lock.tuple
   and blocking_lock.virtualxid is not distinct from waiting_lock.virtualxid
   and blocking_lock.transactionid is not distinct from waiting_lock.transactionid
   and blocking_lock.classid is not distinct from waiting_lock.classid
   and blocking_lock.objid is not distinct from waiting_lock.objid
   and blocking_lock.objsubid is not distinct from waiting_lock.objsubid
  where exists (
    select 1
    from pg_catalog.pg_locks as target_lock
    where target_lock.pid = blocker.waiter_pid
      and target_lock.relation = ${quoteLiteral(targetRelation)}::regclass
      and target_lock.locktype = 'tuple'
  )
  and exists (
    select 1
    from pg_catalog.pg_locks as blocker_target_lock
    where blocker_target_lock.pid = blocker.blocker_pid
      and blocker_target_lock.relation = ${quoteLiteral(targetRelation)}::regclass
      and blocker_target_lock.granted
  )
) then 'blocked' else 'pending' end;
`
}

async function waitForBlockedConnection(
  container,
  { waiterApplication, blockerApplication, targetRelation, trackedProcess, timeoutMs = 5_000 },
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (trackedProcess.child.exitCode !== null) {
      const result = await trackedProcess.completed
      throw new Error(
        `Connection ${waiterApplication} exited before a real lock wait was observed.\n${result.stderr || result.stdout}`,
      )
    }
    const output = await runPsql(
      container,
      referralBlockingProbeSql({ waiterApplication, blockerApplication, targetRelation }),
      { timeoutMs: 3_000 },
    )
    if (output.split(/\r?\n/u).at(-1)?.trim() === 'blocked') return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(
    `Timed out waiting for ${waiterApplication} to block behind ${blockerApplication} on ${targetRelation}.`,
  )
}

function assertProcess(result, expectedPrefix, label) {
  if (result.timedOut || result.code !== 0 || !outputLine(result.stdout, expectedPrefix)) {
    throw new Error(`${label} failed.\n${result.stderr || result.stdout}`)
  }
}

export function assertConfirmationThenPauseResults({ confirmation, pause, verification }) {
  assertProcess(confirmation, 'A|confirmed', 'Confirmation-before-pause transaction')
  assertProcess(pause, 'B|false|1|', 'Pause transaction waiting on confirmation')
  if (verification.trim() !== '1|1|6000000|1|false|1') {
    throw new Error(`Unexpected confirmation-before-pause state: ${verification || '<empty>'}.`)
  }
}

export function assertLostResponseReplayResults({ original, replay, verification }) {
  const originalLine = outputLine(original.stdout, 'B|')
  const replayLine = outputLine(replay.stdout, 'R|')
  assertProcess(original, 'B|false|1|', 'Original pause response')
  assertProcess(replay, 'R|false|1|', 'Lost-response replay')
  if (originalLine?.slice(2) !== replayLine?.slice(2)) {
    throw new Error('Lost-response replay did not return the original committed state.')
  }
  if (verification.trim() !== '1|1') {
    throw new Error(`Lost-response replay changed version or audit count: ${verification}.`)
  }
}

export function assertPauseThenConfirmationResults({ pause, confirmation, verification }) {
  assertProcess(pause, 'D|false|11|', 'Pause-before-confirmation transaction')
  assertProcess(confirmation, 'C|confirmed', 'Confirmation waiting on pause')
  if (verification.trim() !== '1|0|1|6000000|0|false|11') {
    throw new Error(`Unexpected pause-before-confirmation state: ${verification || '<empty>'}.`)
  }
}

export function assertTenthRewardRaceResults({ winner, contender, verification }) {
  assertProcess(winner, 'E|confirmed', 'Tenth reward winner')
  assertProcess(contender, 'F|confirmed', 'Eleventh reward contender')
  if (verification.trim() !== '1|0|10|15000000|1|1|2') {
    throw new Error(`Concurrent tenth-reward state was not exact: ${verification || '<empty>'}.`)
  }
}

function preflightSql() {
  return `
do $$
begin
  if pg_catalog.to_regclass('private.referral_program_config') is null
    or pg_catalog.to_regclass('private.referral_codes') is null
    or pg_catalog.to_regclass('private.referral_bindings') is null
    or pg_catalog.to_regprocedure(
      'public.admin_update_referral_program_config(boolean,bigint,text)'
    ) is null
    or pg_catalog.to_regprocedure('private.process_profile_referral()') is null then
    raise exception 'Referral concurrency migrations are not installed.';
  end if;
end;
$$;
`
}

function configSnapshotSql() {
  return `
select pg_catalog.encode(
  pg_catalog.convert_to(pg_catalog.row_to_json(snapshot)::text, 'UTF8'),
  'hex'
)
from (
  select enabled, version, updated_at, updated_by, change_reason,
         reopen_allowed, reopen_block_reason
  from private.referral_program_config
  where singleton
) as snapshot;
`
}

function parseConfigSnapshot(output) {
  const encoded = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^[0-9a-f]+$/iu.test(line))
  if (!encoded) throw new Error('Could not capture the local referral configuration snapshot.')
  return JSON.parse(Buffer.from(encoded, 'hex').toString('utf8'))
}

export function referralConfigCasPredicateSql(current, alias = 'config') {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(alias)) throw new Error('Unsafe SQL alias for config CAS.')
  return `
${alias}.enabled is not distinct from ${current.enabled ? 'true' : 'false'}
  and ${alias}.version is not distinct from ${Number(current.version)}
  and ${alias}.updated_at is not distinct from ${quoteLiteral(current.updated_at)}::timestamptz
  and ${alias}.updated_by is not distinct from ${current.updated_by ? `${quoteLiteral(current.updated_by)}::uuid` : 'null'}
  and ${alias}.change_reason is not distinct from ${quoteLiteral(current.change_reason)}
  and ${alias}.reopen_allowed is not distinct from ${current.reopen_allowed ? 'true' : 'false'}
  and ${alias}.reopen_block_reason is not distinct from ${quoteLiteral(current.reopen_block_reason)}
`.trim()
}

function fixtureAuditPredicateSql() {
  return `(
    actor_id in (${uuidList()})
    or (
      action = 'referral_reward_granted'
      and target_id in (${fixtureIds.map(quoteLiteral).join(', ')})
    )
  )`
}

function cleanupFixtureSql() {
  return `
begin;
set local statement_timeout = '15s';
set local session_replication_role = 'replica';
delete from public.audit_logs
where ${fixtureAuditPredicateSql()};
delete from private.referral_bindings
where invitee_id in (${uuidList()})
   or inviter_id in (${uuidList()});
delete from public.admin_rate_limit_buckets where actor_id in (${uuidList()});
delete from private.referral_codes where inviter_id in (${uuidList()});
delete from private.webchat_member_access where user_id in (${uuidList()});
delete from public.profiles where id in (${uuidList()});
delete from auth.users where id in (${uuidList()});
set local session_replication_role = 'origin';
commit;
`
}

function cleanupStatementSql(statement, { replica = false } = {}) {
  return `
begin;
set local statement_timeout = '10s';
${replica ? "set local session_replication_role = 'replica';" : ''}
${statement}
${replica ? "set local session_replication_role = 'origin';" : ''}
commit;
`
}

function cleanupAuditSql() {
  return cleanupStatementSql(`delete from public.audit_logs where ${fixtureAuditPredicateSql()};`)
}

function cleanupBindingsSql() {
  return cleanupStatementSql(`
delete from private.referral_bindings
where invitee_id in (${uuidList()}) or inviter_id in (${uuidList()});
`)
}

function cleanupRateLimitsSql() {
  return cleanupStatementSql(
    `delete from public.admin_rate_limit_buckets where actor_id in (${uuidList()});`,
  )
}

function cleanupCodesSql() {
  return cleanupStatementSql(
    `delete from private.referral_codes where inviter_id in (${uuidList()});`,
  )
}

function cleanupAccessSql() {
  return cleanupStatementSql(
    `delete from private.webchat_member_access where user_id in (${uuidList()});`,
  )
}

function cleanupProfilesSql() {
  return cleanupStatementSql(`delete from public.profiles where id in (${uuidList()});`, {
    replica: true,
  })
}

function cleanupAuthSql() {
  return cleanupStatementSql(`delete from auth.users where id in (${uuidList()});`, {
    replica: true,
  })
}

function restoreConfigCasSql(snapshot, current) {
  return `
begin;
set local statement_timeout = '10s';
with restored as (
  update private.referral_program_config
set enabled = ${snapshot.enabled ? 'true' : 'false'},
    version = ${Number(snapshot.version)},
    updated_at = ${quoteLiteral(snapshot.updated_at)}::timestamptz,
    updated_by = ${snapshot.updated_by ? `${quoteLiteral(snapshot.updated_by)}::uuid` : 'null'},
    change_reason = ${quoteLiteral(snapshot.change_reason)},
    reopen_allowed = ${snapshot.reopen_allowed ? 'true' : 'false'},
    reopen_block_reason = ${quoteLiteral(snapshot.reopen_block_reason)}
where singleton
  and ${referralConfigCasPredicateSql(current, 'referral_program_config')}
  returning 1
)
select case when pg_catalog.count(*) = 1 then 'restored' else 'cas_failed' end
from restored;
commit;
`
}

function setupSql(ownership, snapshot) {
  const confirmedRows = fixtureUsers
    .filter(([id]) => [fixture.adminId, fixture.closeOwnerId, fixture.limitOwnerId].includes(id))
    .map(
      ([id, email, name]) => `(
        '00000000-0000-0000-0000-000000000000',
        ${quoteLiteral(id)}::uuid,
        'authenticated', 'authenticated', ${quoteLiteral(email)}, 'test-password',
        pg_catalog.clock_timestamp(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        pg_catalog.jsonb_build_object('full_name', ${quoteLiteral(name)}),
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
      )`,
    )
    .join(',\n')

  const pendingRows = [
    [fixture.confirmBeforeCloseId, fixtureUsers[2][1], fixtureUsers[2][2], fixture.closeOwnerId],
    [fixture.confirmAfterCloseId, fixtureUsers[3][1], fixtureUsers[3][2], fixture.closeOwnerId],
    [fixture.tenthWinnerId, fixtureUsers[5][1], fixtureUsers[5][2], fixture.limitOwnerId],
    [fixture.eleventhContenderId, fixtureUsers[6][1], fixtureUsers[6][2], fixture.limitOwnerId],
  ]
    .map(
      ([id, email, name, ownerId]) => `(
        '00000000-0000-0000-0000-000000000000',
        ${quoteLiteral(id)}::uuid,
        'authenticated', 'authenticated', ${quoteLiteral(email)}, 'test-password', null,
        '{"provider":"email","providers":["email"]}'::jsonb,
        pg_catalog.jsonb_build_object(
          'full_name', ${quoteLiteral(name)},
          'referral_code', (
            select code from private.referral_codes
            where inviter_id = ${quoteLiteral(ownerId)}::uuid
          )
        ),
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
      )`,
    )
    .join(',\n')

  return `
begin;
set local statement_timeout = '15s';

set local session_replication_role = 'replica';
do $$
declare
  changed_rows integer;
begin
  update private.referral_program_config as config
  set enabled = true,
      version = 0,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = null,
      change_reason = ${quoteLiteral(ownership.setupReason)},
      reopen_allowed = true,
      reopen_block_reason = ${quoteLiteral(ownership.blockReason)}
  where config.singleton
    and ${referralConfigCasPredicateSql(snapshot)};
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'Referral configuration changed before checker setup CAS.'
      using errcode = '40001';
  end if;
end;
$$;
set local session_replication_role = 'origin';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
${confirmedRows};

update public.profiles
set role = case when id = ${quoteLiteral(fixture.adminId)}::uuid
                  then 'admin'::public.app_role else 'member'::public.app_role end,
    review_status = 'approved',
    approved_at = pg_catalog.clock_timestamp()
where id in (${uuidList([fixture.adminId, fixture.closeOwnerId, fixture.limitOwnerId])});

update private.referral_codes
set reward_count = 9,
    updated_at = pg_catalog.clock_timestamp()
where inviter_id = ${quoteLiteral(fixture.limitOwnerId)}::uuid;
update private.webchat_member_access
set total_token_limit = 14000000,
    version = version + 1,
    updated_at = pg_catalog.clock_timestamp()
where user_id = ${quoteLiteral(fixture.limitOwnerId)}::uuid;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
${pendingRows};

update public.profiles
set review_status = 'approved', approved_at = pg_catalog.clock_timestamp()
where id in (${uuidList([
    fixture.confirmBeforeCloseId,
    fixture.confirmAfterCloseId,
    fixture.tenthWinnerId,
    fixture.eleventhContenderId,
  ])});

commit;
`
}

function adminClaimsSql() {
  return `
select pg_catalog.set_config(
  'request.jwt.claim.sub', ${quoteLiteral(fixture.adminId)}, true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  ${quoteLiteral(JSON.stringify({ sub: fixture.adminId, role: 'authenticated' }))},
  true
);
`
}

function confirmationSql(id, label, holdSeconds = null) {
  return `
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
update auth.users
set email_confirmed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
where id = ${quoteLiteral(id)}::uuid;
select ${quoteLiteral(`${label}|confirmed`)};
${holdSeconds === null ? '' : `select pg_catalog.pg_sleep(${holdSeconds});`}
commit;
`
}

export function referralControlledPauseSql({
  label,
  expectedVersion,
  expectedCurrent,
  reason,
  holdSeconds = null,
}) {
  return `
begin;
set local statement_timeout = '15s';
set local lock_timeout = '10s';
${adminClaimsSql()}
-- This local-only controlled wrapper deliberately mirrors the production
-- acquisition prefix: rate-limit bucket, administrator profile, then config.
-- The full-field CAS below is an extra checker fence; it is not a claim that
-- admin_update_referral_program_config natively performs a full-field CAS.
select *
from public.consume_admin_rate_limit(
  ${quoteLiteral(fixture.adminId)}::uuid,
  'referral_program.write',
  10,
  300
);
do $$
begin
  perform 1
  from public.profiles as administrator
  where administrator.id = ${quoteLiteral(fixture.adminId)}::uuid
    and administrator.role = 'admin'::public.app_role
    and administrator.review_status = 'approved'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
end;
$$;
do $$
begin
  perform 1
  from private.referral_program_config as config
  where config.singleton
    and ${referralConfigCasPredicateSql(expectedCurrent)}
  for update;
  if not found then
    raise exception 'Referral configuration changed before pause CAS.'
      using errcode = '40001';
  end if;
end;
$$;
set local role authenticated;
select ${quoteLiteral(`${label}|`)}
  || enabled::text || '|'
  || version::text || '|'
  || pg_catalog.date_part('epoch', updated_at)::text || '|'
  || reason
from public.admin_update_referral_program_config(
  false,
  ${expectedVersion},
  ${quoteLiteral(reason)}
);
${holdSeconds === null ? '' : `select pg_catalog.pg_sleep(${holdSeconds});`}
commit;
`
}

function confirmationThenPauseVerificationSql() {
  return `
select
  (select pg_catalog.count(*) from private.referral_bindings
   where invitee_id = ${quoteLiteral(fixture.confirmBeforeCloseId)}::uuid)::text || '|' ||
  (select reward_count from private.referral_codes
   where inviter_id = ${quoteLiteral(fixture.closeOwnerId)}::uuid)::text || '|' ||
  (select total_token_limit from private.webchat_member_access
   where user_id = ${quoteLiteral(fixture.closeOwnerId)}::uuid)::text || '|' ||
  (select pg_catalog.count(*) from public.audit_logs
   where actor_id = ${quoteLiteral(fixture.confirmBeforeCloseId)}::uuid
     and action = 'referral_reward_granted')::text || '|' ||
  (select enabled from private.referral_program_config where singleton)::text || '|' ||
  (select version from private.referral_program_config where singleton)::text;
`
}

function replayVerificationSql() {
  return `
select
  (select version from private.referral_program_config where singleton)::text || '|' ||
  (select pg_catalog.count(*) from public.audit_logs
   where actor_id = ${quoteLiteral(fixture.adminId)}::uuid
     and action = 'referral_program_config_update')::text;
`
}

function prepareSecondPauseSql(ownership, current) {
  return `
begin;
do $$
declare
  changed_rows integer;
begin
  update private.referral_program_config as config
  set enabled = true, version = 10, updated_by = null,
      updated_at = pg_catalog.clock_timestamp(),
      change_reason = ${quoteLiteral(ownership.secondPreparationReason)}
  where config.singleton
    and ${referralConfigCasPredicateSql(current)};
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'Referral configuration changed before second-phase CAS.'
      using errcode = '40001';
  end if;
end;
$$;
commit;
`
}

function pauseThenConfirmationVerificationSql() {
  return `
select
  (select pg_catalog.count(*) from auth.users
   where id = ${quoteLiteral(fixture.confirmAfterCloseId)}::uuid
     and email_confirmed_at is not null)::text || '|' ||
  (select pg_catalog.count(*) from private.referral_bindings
   where invitee_id = ${quoteLiteral(fixture.confirmAfterCloseId)}::uuid)::text || '|' ||
  (select reward_count from private.referral_codes
   where inviter_id = ${quoteLiteral(fixture.closeOwnerId)}::uuid)::text || '|' ||
  (select total_token_limit from private.webchat_member_access
   where user_id = ${quoteLiteral(fixture.closeOwnerId)}::uuid)::text || '|' ||
  (select pg_catalog.count(*) from public.audit_logs
   where actor_id = ${quoteLiteral(fixture.confirmAfterCloseId)}::uuid
     and action = 'referral_reward_granted')::text || '|' ||
  (select enabled from private.referral_program_config where singleton)::text || '|' ||
  (select version from private.referral_program_config where singleton)::text;
`
}

function prepareRewardRaceSql(ownership, current) {
  return `
begin;
do $$
declare
  changed_rows integer;
begin
  update private.referral_program_config as config
  set enabled = true, version = 20, updated_by = null,
      updated_at = pg_catalog.clock_timestamp(),
      change_reason = ${quoteLiteral(ownership.rewardPreparationReason)}
  where config.singleton
    and ${referralConfigCasPredicateSql(current)};
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'Referral configuration changed before reward-race CAS.'
      using errcode = '40001';
  end if;
end;
$$;
commit;
`
}

function rewardRaceVerificationSql() {
  return `
select
  (select pg_catalog.count(*) from private.referral_bindings
   where invitee_id = ${quoteLiteral(fixture.tenthWinnerId)}::uuid)::text || '|' ||
  (select pg_catalog.count(*) from private.referral_bindings
   where invitee_id = ${quoteLiteral(fixture.eleventhContenderId)}::uuid)::text || '|' ||
  (select reward_count from private.referral_codes
   where inviter_id = ${quoteLiteral(fixture.limitOwnerId)}::uuid)::text || '|' ||
  (select total_token_limit from private.webchat_member_access
   where user_id = ${quoteLiteral(fixture.limitOwnerId)}::uuid)::text || '|' ||
  (select pg_catalog.count(*) from public.audit_logs
   where action = 'referral_reward_granted'
     and target_id = ${quoteLiteral(fixture.limitOwnerId)})::text || '|' ||
  (select pg_catalog.count(*) from private.referral_bindings
   where inviter_id = ${quoteLiteral(fixture.limitOwnerId)}::uuid)::text || '|' ||
  (select pg_catalog.count(*) from auth.users
   where id in (${uuidList([fixture.tenthWinnerId, fixture.eleventhContenderId])})
     and email_confirmed_at is not null)::text;
`
}

function cleanupVerificationSql(snapshot) {
  const expectedSnapshot = quoteLiteral(JSON.stringify(snapshot))
  return `
select
  (select pg_catalog.count(*) from auth.users where id in (${uuidList()}))::text || '|' ||
  (select pg_catalog.count(*) from public.profiles where id in (${uuidList()}))::text || '|' ||
  (select pg_catalog.count(*) from private.referral_codes where inviter_id in (${uuidList()}))::text || '|' ||
  (select pg_catalog.count(*) from private.referral_bindings
   where invitee_id in (${uuidList()}) or inviter_id in (${uuidList()}))::text || '|' ||
  (select pg_catalog.count(*) from private.webchat_member_access where user_id in (${uuidList()}))::text || '|' ||
  (select pg_catalog.count(*) from public.admin_rate_limit_buckets where actor_id in (${uuidList()}))::text || '|' ||
  (select pg_catalog.count(*) from public.audit_logs
   where ${fixtureAuditPredicateSql()})::text || '|' ||
  (
    select (
      pg_catalog.row_to_json(current_config)::jsonb = ${expectedSnapshot}::jsonb
    )::text
    from (
      select enabled, version, updated_at, updated_by, change_reason,
             reopen_allowed, reopen_block_reason
      from private.referral_program_config
      where singleton
    ) as current_config
  );
`
}

function guardSql() {
  return `
do $$
begin
  if not pg_catalog.pg_try_advisory_lock(${advisoryLockKey}) then
    raise exception 'Another referral concurrency verification is already running.';
  end if;
end;
$$;
select 'GUARD|locked';
select pg_catalog.pg_sleep(120);
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

function taggedSessionCountSql(applicationNames) {
  return `
select pg_catalog.count(*)::text
from pg_catalog.pg_stat_activity
where application_name in (${applicationNames.map(quoteLiteral).join(', ')})
  and pid <> pg_catalog.pg_backend_pid();
`
}

function guardIsolationFixtureSql() {
  const [, email, name] = fixtureUsers[0]
  return `
begin;
set local statement_timeout = '10s';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  ${quoteLiteral(fixture.adminId)}::uuid,
  'authenticated', 'authenticated', ${quoteLiteral(email)}, 'test-password',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object('full_name', ${quoteLiteral(name)}),
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
);
commit;
`
}

function guardIsolationFixtureCountSql() {
  return `
select
  (select pg_catalog.count(*) from auth.users
   where id = ${quoteLiteral(fixture.adminId)}::uuid)::text || '|' ||
  (select pg_catalog.count(*) from public.profiles
   where id = ${quoteLiteral(fixture.adminId)}::uuid)::text;
`
}

export async function runReferralGuardIsolationSelfTest({
  container = findLocalSupabaseDatabaseContainer(),
  project = process.env.SUPABASE_PROJECT_ID ?? defaultProject,
} = {}) {
  assertLocalSupabaseContainer(container, { expectedProject: project })
  const runId = `guard-isolation-${process.pid}-${Date.now()}`
  const holderApplication = `referral-guard-holder-${runId}`
  const holder = []
  let guardAcquired = false
  let primaryError = null

  try {
    const guard = createPsqlProcess(container, guardSql(), {
      applicationName: holderApplication,
      timeoutMs: 125_000,
    })
    holder.push(guard)
    await waitForProcessOutput(guard, 'GUARD|locked', 5_000)
    guardAcquired = true

    await runPsql(container, preflightSql(), { timeoutMs: 10_000 })
    await runPsql(container, cleanupFixtureSql(), { timeoutMs: 10_000 })
    await runPsql(container, guardIsolationFixtureSql(), { timeoutMs: 10_000 })

    let rejected = false
    try {
      await runReferralConcurrencyCheck({ container, project, holdSeconds: 0.25 })
    } catch (error) {
      if (error.message.includes('Another referral concurrency verification is already running.')) {
        rejected = true
      } else {
        throw error
      }
    }
    if (!rejected) throw new Error('A second referral checker unexpectedly acquired the guard.')

    const fixtureCount = await runPsql(container, guardIsolationFixtureCountSql(), {
      timeoutMs: 5_000,
    })
    if (fixtureCount.trim() !== '1|1') {
      throw new Error(
        `The rejected checker modified the guard holder fixture: ${fixtureCount || '<empty>'}.`,
      )
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    for (const process of holder) {
      if (process.child.exitCode === null) process.child.kill('SIGKILL')
    }
    await Promise.allSettled(holder.map((process) => process.completed))

    const cleanupErrors = []
    const cleanupStep = async (label, operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`)
      }
    }
    await cleanupStep('terminate guard-isolation holder', () =>
      runPsql(container, terminateSessionsSql([holderApplication]), { timeoutMs: 5_000 }),
    )
    await cleanupStep('verify guard-isolation holder stopped', async () => {
      const remaining = await runPsql(container, taggedSessionCountSql([holderApplication]), {
        timeoutMs: 5_000,
      })
      if (remaining.trim() !== '0') throw new Error(`${remaining.trim()} holder session remains.`)
    })
    if (guardAcquired) {
      await cleanupStep('delete guard-isolation fixture', () =>
        runPsql(container, cleanupFixtureSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('verify guard-isolation fixture cleanup', async () => {
        const fixtureCount = await runPsql(container, guardIsolationFixtureCountSql(), {
          timeoutMs: 5_000,
        })
        if (fixtureCount.trim() !== '0|0') {
          throw new Error(`${fixtureCount.trim()} fixture rows remain.`)
        }
      })
    }
    if (cleanupErrors.length > 0) {
      const cleanupError = new Error(
        `Referral guard-isolation cleanup failed:\n- ${cleanupErrors.join('\n- ')}`,
      )
      if (primaryError) primaryError.message = `${primaryError.message}\n${cleanupError.message}`
      else throw cleanupError
    }
  }

  return { container }
}

export async function runReferralConcurrencyCheck({
  container = findLocalSupabaseDatabaseContainer(),
  holdSeconds = 3,
  project = process.env.SUPABASE_PROJECT_ID ?? defaultProject,
} = {}) {
  assertLocalSupabaseContainer(container, { expectedProject: project })
  const runId = `${process.pid}-${Date.now()}`
  const applications = referralConcurrencyApplicationNames(runId)
  const ownership = referralConcurrencyOwnership(runId)
  const processes = []
  let snapshot = null
  let primaryError = null
  let guardAcquired = false

  try {
    const guard = createPsqlProcess(container, guardSql(), {
      applicationName: applications.guard,
      timeoutMs: 125_000,
    })
    processes.push(guard)
    await waitForProcessOutput(guard, 'GUARD|locked', 5_000)
    guardAcquired = true

    await runPsql(container, preflightSql(), { timeoutMs: 10_000 })
    snapshot = await readReferralConfig(container)
    await runPsql(container, cleanupFixtureSql(), { timeoutMs: 10_000 })
    await runPsql(container, setupSql(ownership, snapshot), { timeoutMs: 15_000 })
    const setupState = await readReferralConfig(container)
    if (!isExpectedReferralOwnedPhase(setupState, ownership, 'setup')) {
      throw new Error('Checker setup did not commit the exact owned configuration phase.')
    }

    const confirmationFirst = createPsqlProcess(
      container,
      confirmationSql(fixture.confirmBeforeCloseId, 'A', holdSeconds),
      { applicationName: applications.confirmFirst, timeoutMs: 20_000 },
    )
    processes.push(confirmationFirst)
    await waitForProcessOutput(confirmationFirst, 'A|confirmed')
    const pauseAfter = createPsqlProcess(
      container,
      referralControlledPauseSql({
        label: 'B',
        expectedVersion: 0,
        expectedCurrent: setupState,
        reason: ownership.firstPauseReason,
      }),
      { applicationName: applications.pauseAfter, timeoutMs: 20_000 },
    )
    processes.push(pauseAfter)
    await waitForBlockedConnection(container, {
      waiterApplication: applications.pauseAfter,
      blockerApplication: applications.confirmFirst,
      targetRelation: 'private.referral_program_config',
      trackedProcess: pauseAfter,
    })
    const [confirmationFirstResult, pauseAfterResult] = await Promise.all([
      confirmationFirst.completed,
      pauseAfter.completed,
    ])
    const firstVerification = await runPsql(container, confirmationThenPauseVerificationSql(), {
      timeoutMs: 5_000,
    })
    assertConfirmationThenPauseResults({
      confirmation: confirmationFirstResult,
      pause: pauseAfterResult,
      verification: firstVerification,
    })

    const firstPauseState = await readReferralConfig(container)
    if (!isExpectedReferralOwnedPhase(firstPauseState, ownership, 'firstPause')) {
      throw new Error('First pause did not commit the exact owned configuration phase.')
    }

    const replay = createPsqlProcess(
      container,
      referralControlledPauseSql({
        label: 'R',
        expectedVersion: 0,
        expectedCurrent: firstPauseState,
        reason: ownership.firstPauseReason,
      }),
      { applicationName: applications.replay, timeoutMs: 10_000 },
    )
    processes.push(replay)
    const replayResult = await replay.completed
    const replayVerification = await runPsql(container, replayVerificationSql(), {
      timeoutMs: 5_000,
    })
    assertLostResponseReplayResults({
      original: pauseAfterResult,
      replay: replayResult,
      verification: replayVerification,
    })

    await runPsql(container, prepareSecondPauseSql(ownership, firstPauseState), {
      timeoutMs: 5_000,
    })
    const secondPreparationState = await readReferralConfig(container)
    if (!isExpectedReferralOwnedPhase(secondPreparationState, ownership, 'secondPreparation')) {
      throw new Error('Second preparation did not commit the exact owned configuration phase.')
    }
    const pauseFirst = createPsqlProcess(
      container,
      referralControlledPauseSql({
        label: 'D',
        expectedVersion: 10,
        expectedCurrent: secondPreparationState,
        reason: ownership.secondPauseReason,
        holdSeconds,
      }),
      { applicationName: applications.pauseFirst, timeoutMs: 20_000 },
    )
    processes.push(pauseFirst)
    await waitForProcessOutput(pauseFirst, 'D|false|11|')
    const confirmationAfter = createPsqlProcess(
      container,
      confirmationSql(fixture.confirmAfterCloseId, 'C'),
      { applicationName: applications.confirmAfter, timeoutMs: 20_000 },
    )
    processes.push(confirmationAfter)
    await waitForBlockedConnection(container, {
      waiterApplication: applications.confirmAfter,
      blockerApplication: applications.pauseFirst,
      targetRelation: 'private.referral_program_config',
      trackedProcess: confirmationAfter,
    })
    const [pauseFirstResult, confirmationAfterResult] = await Promise.all([
      pauseFirst.completed,
      confirmationAfter.completed,
    ])
    const secondVerification = await runPsql(container, pauseThenConfirmationVerificationSql(), {
      timeoutMs: 5_000,
    })
    assertPauseThenConfirmationResults({
      pause: pauseFirstResult,
      confirmation: confirmationAfterResult,
      verification: secondVerification,
    })

    const secondPauseState = await readReferralConfig(container)
    if (!isExpectedReferralOwnedPhase(secondPauseState, ownership, 'secondPause')) {
      throw new Error('Second pause did not commit the exact owned configuration phase.')
    }
    await runPsql(container, prepareRewardRaceSql(ownership, secondPauseState), {
      timeoutMs: 5_000,
    })
    const rewardPreparationState = await readReferralConfig(container)
    if (!isExpectedReferralOwnedPhase(rewardPreparationState, ownership, 'rewardPreparation')) {
      throw new Error('Reward preparation did not commit the exact owned configuration phase.')
    }
    const tenth = createPsqlProcess(
      container,
      confirmationSql(fixture.tenthWinnerId, 'E', holdSeconds),
      { applicationName: applications.tenth, timeoutMs: 20_000 },
    )
    processes.push(tenth)
    await waitForProcessOutput(tenth, 'E|confirmed')
    const eleventh = createPsqlProcess(
      container,
      confirmationSql(fixture.eleventhContenderId, 'F'),
      { applicationName: applications.eleventh, timeoutMs: 20_000 },
    )
    processes.push(eleventh)
    await waitForBlockedConnection(container, {
      waiterApplication: applications.eleventh,
      blockerApplication: applications.tenth,
      targetRelation: 'private.referral_codes',
      trackedProcess: eleventh,
    })
    const [tenthResult, eleventhResult] = await Promise.all([tenth.completed, eleventh.completed])
    const rewardVerification = await runPsql(container, rewardRaceVerificationSql(), {
      timeoutMs: 5_000,
    })
    assertTenthRewardRaceResults({
      winner: tenthResult,
      contender: eleventhResult,
      verification: rewardVerification,
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    for (const process of processes) {
      if (process.child.exitCode === null) process.child.kill('SIGKILL')
    }
    await Promise.allSettled(processes.map((process) => process.completed))

    const cleanupErrors = []
    const cleanupStep = async (label, operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`)
      }
    }

    const applicationNames = Object.values(applications)
    await cleanupStep('terminate tagged database sessions', () =>
      runPsql(container, terminateSessionsSql(applicationNames), { timeoutMs: 5_000 }),
    )
    await cleanupStep('verify tagged database sessions', async () => {
      const remaining = await runPsql(container, taggedSessionCountSql(applicationNames), {
        timeoutMs: 5_000,
      })
      if (remaining.trim() !== '0') {
        throw new Error(`${remaining.trim()} tagged database session(s) remain.`)
      }
    })

    if (guardAcquired && snapshot) {
      await cleanupStep('restore referral configuration with CAS', async () => {
        const current = await readReferralConfig(container)
        const plan = planReferralConfigCleanup({ current, original: snapshot, ownership })
        if (plan.classification === 'external') {
          throw new Error(
            'Referral configuration no longer carries an expected checker-owned state; refusing to overwrite it.',
          )
        }
        if (!plan.restoreConfig) return
        const restored = await runPsql(container, restoreConfigCasSql(snapshot, current), {
          timeoutMs: 10_000,
        })
        if (restored.split(/\r?\n/u).at(-1)?.trim() !== 'restored') {
          throw new Error('Referral configuration changed during CAS restoration.')
        }
      })
    }

    if (guardAcquired) {
      await cleanupStep('delete fixture audit rows', () =>
        runPsql(container, cleanupAuditSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('delete fixture bindings', () =>
        runPsql(container, cleanupBindingsSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('delete fixture rate limits', () =>
        runPsql(container, cleanupRateLimitsSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('delete fixture codes', () =>
        runPsql(container, cleanupCodesSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('delete fixture WebChat access', () =>
        runPsql(container, cleanupAccessSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('delete fixture profiles', () =>
        runPsql(container, cleanupProfilesSql(), { timeoutMs: 10_000 }),
      )
      await cleanupStep('delete fixture Auth users', () =>
        runPsql(container, cleanupAuthSql(), { timeoutMs: 10_000 }),
      )
    }

    if (guardAcquired && snapshot) {
      await cleanupStep('verify cleanup and configuration consistency', async () => {
        const cleanupVerification = await runPsql(container, cleanupVerificationSql(snapshot), {
          timeoutMs: 5_000,
        })
        if (cleanupVerification.trim() !== '0|0|0|0|0|0|0|true') {
          throw new Error(
            `Referral concurrency cleanup left residual or inconsistent state: ${cleanupVerification || '<empty>'}.`,
          )
        }
      })
    }

    if (cleanupErrors.length > 0) {
      const cleanupError = new Error(
        `Referral concurrency cleanup failed:\n- ${cleanupErrors.join('\n- ')}`,
      )
      if (primaryError) primaryError.message = `${primaryError.message}\n${cleanupError.message}`
      else throw cleanupError
    }
  }

  return { container }
}

async function main() {
  const guardIsolation = await runReferralGuardIsolationSelfTest()
  if (process.argv.includes('--guard-isolation-only')) {
    console.log(
      `Verified referral guard isolation in ${guardIsolation.container}: a rejected second checker left the holder fixture unchanged and cleaned only its own tagged sessions.`,
    )
    return
  }
  const result = await runReferralConcurrencyCheck()
  console.log(
    `Verified referral concurrency in ${result.container}: guard isolation, shutdown fencing, confirmation ordering, exact lost-response reconciliation, and the concurrent tenth-reward boundary all preserved atomic state with zero fixture residue. The local controlled wrapper acquired rate-limit, administrator-profile, and config locks in production order before invoking the original admin_update_referral_program_config RPC; its full-field CAS is an additional checker fence, not native RPC behavior. PostgreSQL exposes these row waits through transactionid locks; expected blocker applications plus target-table relation locks anchor each observation to the intended config or referral-code row path.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Referral concurrency check failed: ${error.message}`)
    process.exitCode = 1
  })
}
