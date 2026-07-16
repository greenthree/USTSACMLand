import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url)
const deployWorkflowUrl = new URL('../.github/workflows/deploy-pages.yml', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)
const supabaseConfigUrl = new URL('../supabase/config.toml', import.meta.url)
const databaseTypesUrl = new URL('../src/types/database.ts', import.meta.url)
const pgTapDirectoryUrl = new URL('../supabase/tests/', import.meta.url)
const migrationDirectoryUrl = new URL('../supabase/migrations/', import.meta.url)

const requiredReleaseMigrations = [
  '202607140008_xcpc_elo_shared_cache.sql',
  '202607140009_snapshot_source_idempotency.sql',
  '202607140010_platform_account_canonicalization.sql',
  '202607140011_account_deletion_lifecycle.sql',
  '202607140012_persistent_sync_queue.sql',
  '202607150001_admin_sync_queue_progress.sql',
  '202607150002_admin_announcements.sql',
  '202607150003_admin_rate_limits.sql',
  '202607150004_atcoder_manual_solved_count.sql',
  '202607150005_luogu_snapshot_idempotency.sql',
  '202607160001_atomic_non_luogu_sync_commit.sql',
  '202607160002_xcpc_manual_decimal_ratings.sql',
  '202607160003_account_deletion_security_hardening.sql',
  '202607160004_sync_profile_final_guard.sql',
  '202607160005_admin_role_handoff.sql',
  '202607160006_prevent_admin_account_deletion.sql',
  '202607160007_account_deletion_recovery_lease_renewal.sql',
  '202607160008_allow_auth_admin_profile_cleanup.sql',
  '202607160009_allow_pending_luogu_failure_commit.sql',
]

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

export function verifyDatabaseTypes(databaseTypes) {
  for (const table of ['xcpc_elo_cache_state', 'xcpc_elo_cache_players']) {
    requireMatch(
      databaseTypes,
      new RegExp(`\\b${table}:\\s*\\{`),
      `Generated database types are missing table ${table}.`,
    )
  }
  for (const rpc of [
    'read_xcpc_elo_cache',
    'acquire_xcpc_elo_cache_refresh',
    'commit_xcpc_elo_cache_refresh',
    'validate_xcpc_elo_cache_refresh',
    'fail_xcpc_elo_cache_refresh',
    'commit_platform_sync_result',
    'commit_luogu_sync_result',
    'admin_set_member_role',
    'renew_account_deletion_recovery_lease',
  ]) {
    requireMatch(
      databaseTypes,
      new RegExp(`\\b${rpc}:\\s*\\{`),
      `Generated database types are missing RPC ${rpc}.`,
    )
  }
}

function extractStep(workflow, name) {
  const marker = `- name: ${name}`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`CI workflow is missing the ${name} step.`)
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length)
  const nextJob = workflow.indexOf('\n  database-security:', start + marker.length)
  const candidates = [nextStep, nextJob].filter((value) => value >= 0)
  const end = candidates.length > 0 ? Math.min(...candidates) : workflow.length
  return workflow.slice(start, end)
}

export function inspectPgTapSuite(files) {
  const sqlFiles = files
    .filter((file) => file.name.endsWith('.test.sql'))
    .sort((left, right) => left.name.localeCompare(right.name))
  if (sqlFiles.length < 15) {
    throw new Error(`Database CI must discover at least 15 pgTAP files; found ${sqlFiles.length}.`)
  }

  let assertionCount = 0
  let previousPrefix = 0
  for (const file of sqlFiles) {
    const prefix = Number(file.name.slice(0, 2))
    if (!Number.isInteger(prefix) || prefix !== previousPrefix + 1) {
      throw new Error(`pgTAP file prefixes must be contiguous; found ${file.name}.`)
    }
    previousPrefix = prefix

    const plans = [...file.content.matchAll(/select\s+plan\((\d+)\)/gi)]
    if (plans.length !== 1) {
      throw new Error(`pgTAP file ${file.name} must contain exactly one plan().`)
    }
    const planned = Number(plans[0][1])
    if (!Number.isInteger(planned) || planned <= 0) {
      throw new Error(`pgTAP file ${file.name} has an invalid plan count.`)
    }
    assertionCount += planned

    const assertionCalls = [
      ...file.content.matchAll(
        /\bselect\s+(?:extensions\.)?(?:cmp_ok|col_type_is|has_table|is|isnt|lives_ok|matches|ok|results_eq|set_eq|throws_like|throws_ok|unlike)\s*\(/gi,
      ),
    ].length
    if (assertionCalls !== planned) {
      throw new Error(
        `pgTAP file ${file.name} declares plan(${planned}) but contains ${assertionCalls} recognized assertion calls.`,
      )
    }

    for (const required of [/^begin;/im, /select\s+\*\s+from\s+finish\(\);/i, /^rollback;/im]) {
      if (!required.test(file.content)) {
        throw new Error(`pgTAP file ${file.name} is missing its transaction or finish boundary.`)
      }
    }
  }

  if (assertionCount < 250) {
    throw new Error(`Database CI must plan at least 250 pgTAP assertions; found ${assertionCount}.`)
  }

  return { fileCount: sqlFiles.length, assertionCount }
}

export function verifyCiWorkflow(
  workflow,
  packageJson,
  pgTapFiles,
  migrationFiles = [],
  deployWorkflow = '',
  supabaseConfig = '',
) {
  const denoCheckStep = extractStep(workflow, 'Check Edge Functions')
  for (const entrypoint of ['sync-member', 'sync-stats', 'delete-account', 'change-password']) {
    requireMatch(
      denoCheckStep,
      new RegExp(`supabase/functions/${entrypoint}/index\\.ts`),
      `CI must type-check the ${entrypoint} Edge Function entrypoint.`,
    )
  }

  const denoTestStep = extractStep(workflow, 'Test Edge Functions')
  requireMatch(denoTestStep, /\bdeno test\b/, 'CI must execute the Edge Function tests.')
  requireMatch(
    denoTestStep,
    /--allow-read(?:\s|$)/,
    'Edge Function tests need read access for sanitized fixtures.',
  )
  requireMatch(
    denoTestStep,
    /--allow-env(?:\s|$)/,
    'Edge Function tests need scoped environment access for configuration boundaries.',
  )
  requireMatch(
    denoTestStep,
    /--config supabase\/functions\/deno\.json\s+supabase\/functions/,
    'Edge Function tests must use the checked-in Deno config and discover the complete function tree.',
  )
  if (/(?:^|\s)(?:-A|--allow-all)(?:\s|$)/m.test(denoTestStep)) {
    throw new Error('Edge Function tests must not receive unrestricted Deno permissions.')
  }
  if (/--allow-net(?:[=\s]|$)/.test(denoTestStep)) {
    throw new Error('Edge Function unit tests must not contact the network.')
  }

  requireMatch(
    workflow,
    /npx --yes supabase@2\.109\.1 start/,
    'Database CI must pin the Supabase CLI used to build the empty database.',
  )
  requireMatch(
    supabaseConfig,
    /\[db\][\s\S]*?\bmajor_version\s*=\s*17\b/,
    'Local Supabase and empty-database CI must use PostgreSQL 17 to match production.',
  )
  requireMatch(workflow, /run:\s+npm run test:db/, 'Database CI must execute the pgTAP suite.')
  requireMatch(
    workflow,
    /- name: Stop local Supabase\s+if: always\(\)\s+run: npx --yes supabase@2\.109\.1 stop --no-backup/,
    'Database CI must always stop the pinned local Supabase stack without preserving state.',
  )

  const databaseScript = packageJson.scripts?.['test:db']
  if (databaseScript !== 'npx --yes supabase@2.109.1 test db supabase/tests --local') {
    throw new Error('test:db must run the complete checked-in pgTAP directory with the pinned CLI.')
  }

  const migrationNames = new Set(migrationFiles)
  for (const migration of requiredReleaseMigrations) {
    if (!migrationNames.has(migration)) {
      throw new Error(`Database CI release set is missing migration ${migration}.`)
    }
  }

  requireMatch(
    deployWorkflow,
    /workflow_run:\s+workflows:\s+- CI\s+types:\s+- completed\s+branches:\s+- main/s,
    'Pages deployment must be triggered by completion of the main-branch CI workflow.',
  )
  if (/^\s*push:/m.test(deployWorkflow)) {
    throw new Error('Pages deployment must not run in parallel from an independent push trigger.')
  }
  requireMatch(
    deployWorkflow,
    /github\.event\.workflow_run\.conclusion == 'success'/,
    'Pages deployment must reject unsuccessful CI workflow runs.',
  )
  requireMatch(
    deployWorkflow,
    /ref:\s+\$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
    'Pages deployment must build the exact commit that passed CI.',
  )

  return {
    ...inspectPgTapSuite(pgTapFiles),
    releaseMigrationCount: requiredReleaseMigrations.length,
  }
}

async function main() {
  const [
    workflow,
    deployWorkflow,
    packageText,
    supabaseConfig,
    databaseTypes,
    entries,
    migrationEntries,
  ] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(deployWorkflowUrl, 'utf8'),
    readFile(packageUrl, 'utf8'),
    readFile(supabaseConfigUrl, 'utf8'),
    readFile(databaseTypesUrl, 'utf8'),
    readdir(pgTapDirectoryUrl, { withFileTypes: true }),
    readdir(migrationDirectoryUrl, { withFileTypes: true }),
  ])
  const pgTapFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.sql'))
      .map(async (entry) => ({
        name: entry.name,
        content: await readFile(new URL(entry.name, pgTapDirectoryUrl), 'utf8'),
      })),
  )
  const report = verifyCiWorkflow(
    workflow,
    JSON.parse(packageText),
    pgTapFiles,
    migrationEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    deployWorkflow,
    supabaseConfig,
  )
  verifyDatabaseTypes(databaseTypes)
  console.log(
    `Verified CI database path: ${report.fileCount} pgTAP files, ${report.assertionCount} planned assertions, and ${report.releaseMigrationCount} protected release migrations.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
