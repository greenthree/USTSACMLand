import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url)
const deployWorkflowUrl = new URL('../.github/workflows/deploy-pages.yml', import.meta.url)
const imageCleanupWorkflowUrl = new URL(
  '../.github/workflows/webchat-image-cleanup.yml',
  import.meta.url,
)
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
  '202607160010_transactional_auth_user_deletion.sql',
  '202607170001_announcement_conflict_http_status.sql',
  '202607170002_admin_rate_limit_http_status.sql',
  '202607170003_atomic_sync_job_completion.sql',
  '202607170004_database_sync_queue_scheduler.sql',
  '202607170005_webchat_quota_claims.sql',
  '202607170006_webchat_relay_admin_config.sql',
  '202607170007_webchat_budget_monitoring.sql',
  '202607170008_webchat_member_access.sql',
  '202607170009_webchat_admin_access.sql',
  '202607170010_webchat_model_visibility.sql',
  '202607180001_daily_problem_learning.sql',
  '202607180002_webchat_pilot_observability.sql',
  '202607180003_webchat_total_member_quotas.sql',
  '202607180004_public_practice_increment_rankings.sql',
  '202607180005_webchat_conversation_history.sql',
  '202607180006_webchat_cache_probe_accounting.sql',
  '202607190001_webchat_real_request_cache_accounting.sql',
  '202607190002_firecrawl_multi_key_admin.sql',
  '202607190005_personal_data_export.sql',
  '202607200001_sync_single_retry.sql',
  '202607200002_clear_public_schema_lint.sql',
  '202607210002_training_goals.sql',
  '202607210003_default_webchat_access.sql',
  '202607220001_referral_program.sql',
  '202607220002_referral_program_global_switch.sql',
  '202607230000_referral_confirmed_rewards.sql',
  '202607230001_webchat_image_attachments.sql',
  '202607230002_pause_referrals_pending_abuse_controls.sql',
  '202607230003_referral_reopen_safety_gate.sql',
  '202607230004_webchat_image_global_limits.sql',
  '202607230005_sync_job_platform_isolation.sql',
  '202607230006_sync_worker_service_role_permissions.sql',
  '202607230007_account_deletion_storage_fence.sql',
]

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

export function verifyDatabaseTypes(databaseTypes) {
  for (const table of [
    'xcpc_elo_cache_state',
    'xcpc_elo_cache_players',
    'daily_problems',
    'daily_problem_completions',
    'daily_problem_comments',
    'training_goals',
  ]) {
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
    'complete_sync_job_attempt',
    'read_sync_queue_scheduler_health',
    'claim_webchat_request_internal',
    'claim_webchat_total_request',
    'calculate_webchat_member_total_usage',
    'reconcile_expired_webchat_member_requests',
    'mark_webchat_request_started',
    'finalize_webchat_request',
    'release_webchat_request',
    'read_webchat_relay_config',
    'read_webchat_relay_runtime_config',
    'admin_update_webchat_relay_config',
    'read_webchat_global_budget_usage',
    'claim_webchat_budget_alert',
    'claim_webchat_cache_probe',
    'mark_webchat_cache_probe_started',
    'finalize_webchat_cache_probe',
    'release_webchat_cache_probe',
    'purge_webchat_cache_probe_runs',
    'admin_get_webchat_member_access',
    'admin_update_webchat_member_access',
    'admin_list_webchat_pilot_members',
    'admin_read_webchat_cache_summary',
    'read_webchat_member_runtime_access',
    'read_own_webchat_usage',
    'claim_authorized_webchat_request',
    'mark_authorized_webchat_request_started',
    'admin_set_member_role',
    'renew_account_deletion_recovery_lease',
    'delete_auth_user_with_recovery_lease',
    'read_daily_problem_feed',
    'set_own_daily_problem_completion',
    'list_daily_problem_comments',
    'create_daily_problem_comment',
    'delete_own_daily_problem_comment',
    'admin_list_daily_problems',
    'admin_upsert_daily_problem',
    'admin_delete_daily_problem',
    'admin_set_daily_problem_comment_visibility',
    'get_public_practice_increments',
    'create_own_webchat_conversation',
    'list_own_webchat_conversations',
    'get_own_webchat_conversation',
    'rename_own_webchat_conversation',
    'set_own_webchat_conversation_archived',
    'delete_own_webchat_conversation',
    'load_own_webchat_messages',
    'upsert_own_webchat_message',
    'delete_own_webchat_messages',
    'purge_expired_webchat_conversations',
    'admin_list_firecrawl_api_keys',
    'admin_upsert_firecrawl_api_key',
    'admin_delete_firecrawl_api_key',
    'select_firecrawl_runtime_key',
    'list_firecrawl_runtime_keys',
    'read_firecrawl_runtime_key',
    'record_firecrawl_key_observation',
    'export_own_data',
    'list_own_training_goals',
    'create_own_training_goal',
    'update_own_training_goal',
    'complete_own_training_goal',
    'archive_own_training_goal',
    'export_own_training_goals',
    'reserve_webchat_image_attachment',
    'start_webchat_image_validation',
    'renew_webchat_image_validation',
    'complete_webchat_image_validation',
    'fail_webchat_image_validation',
    'bind_webchat_image_attachments',
    'read_webchat_image_attachment_for_preview',
    'read_webchat_image_attachment_for_model',
    'read_own_webchat_image_attachment_preview',
    'queue_webchat_image_attachment_deletion',
    'enqueue_expired_webchat_image_attachments',
    'claim_webchat_image_deletion_queue',
    'complete_webchat_image_deletion',
    'retry_webchat_image_deletion',
    'list_webchat_image_deletion_dead_letters',
    'requeue_webchat_image_deletion_dead_letter',
    'purge_deleted_webchat_image_attachments',
    'reconcile_webchat_image_storage_accounting',
  ]) {
    requireMatch(
      databaseTypes,
      new RegExp(`\\b${rpc}:\\s*\\{`),
      `Generated database types are missing RPC ${rpc}.`,
    )
  }

  for (const field of [
    'requested_total_request_limit',
    'requested_total_token_limit',
    'remaining_total_requests',
    'remaining_total_tokens',
    'total_request_limit',
    'total_token_limit',
    'used_requests',
    'used_tokens',
  ]) {
    requireMatch(
      databaseTypes,
      new RegExp(`\\b${field}:`),
      `Generated database types are missing cumulative member quota field ${field}.`,
    )
  }
  if (/\brequested_daily_(?:request|token)_limit:/.test(databaseTypes)) {
    throw new Error('Generated database types still expose the removed daily member quota API.')
  }
  if (/\badmin_(?:get|update)_webchat_member_policy:\s*\{/.test(databaseTypes)) {
    throw new Error('Generated database types still expose the retired WebChat pilot policy API.')
  }
  if (/\badmin_read_webchat_pilot_observation:\s*\{/.test(databaseTypes)) {
    throw new Error('Generated database types still expose the retired WebChat observation API.')
  }
  if (/\bclaim_webchat_request:\s*\{/.test(databaseTypes)) {
    throw new Error('Generated database types still expose the retired WebChat core claim name.')
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
  if (sqlFiles.length < 24) {
    throw new Error(`Database CI must discover at least 24 pgTAP files; found ${sqlFiles.length}.`)
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
        /\bselect\s+(?:extensions\.)?(?:cmp_ok|col_type_is|has_function|has_table|is|isnt|lives_ok|matches|ok|results_eq|set_eq|throws_like|throws_ok|unlike)\s*\(/gi,
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

  if (assertionCount < 500) {
    throw new Error(`Database CI must plan at least 500 pgTAP assertions; found ${assertionCount}.`)
  }

  return { fileCount: sqlFiles.length, assertionCount }
}

export function verifyWebchatImageCleanupWorkflow(workflow) {
  if (!workflow) throw new Error('WebChat image cleanup workflow must be checked in.')
  requireMatch(
    workflow,
    /name:\s+Clean WebChat image objects/,
    'Image cleanup workflow must have the expected job identity.',
  )
  requireMatch(
    workflow,
    /schedule:[\s\S]*cron:\s*['"]?\*\/10 \* \* \* \*['"]?/,
    'Image cleanup workflow must run on its ten-minute schedule.',
  )
  requireMatch(
    workflow,
    /workflow_dispatch:/,
    'Image cleanup workflow must support a bounded manual run.',
  )
  requireMatch(
    workflow,
    /github\.repository == 'greenthree\/USTSACMLand'[\s\S]*github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/,
    'Image cleanup workflow must be restricted to the production repository default branch.',
  )
  requireMatch(
    workflow,
    /github\.event_name == 'workflow_dispatch' \|\| vars\.WEBCHAT_IMAGE_CLEANUP_ENABLED == 'true'/,
    'Scheduled image cleanup must remain disabled until the production feature gate is explicitly enabled.',
  )
  requireMatch(
    workflow,
    /environment:\s*name:\s+production-operations/,
    'Image cleanup workflow must use the protected production operations environment.',
  )
  requireMatch(
    workflow,
    /set -euo pipefail/,
    'Image cleanup workflow must fail closed on shell, curl, and jq errors.',
  )
  requireMatch(
    workflow,
    /SUPABASE_PROJECT_REF.*secrets\.SUPABASE_PROJECT_REF[\s\S]*SUPABASE_SERVICE_ROLE_KEY.*secrets\.SUPABASE_SERVICE_ROLE_KEY/,
    'Image cleanup workflow must source both Supabase credentials from Actions secrets.',
  )
  requireMatch(
    workflow,
    /if \[\[ "\$SUPABASE_PROJECT_REF" != 'qzggoqdmsvktrtnjislw' \]\]/,
    'Image cleanup workflow must be pinned to the production Supabase project ref.',
  )
  requireMatch(
    workflow,
    /--output "\$response"[\s\S]*--write-out '%\{http_code\}'[\s\S]*functions\/v1\/webchat-image-cleanup/,
    'Image cleanup workflow must capture a bounded private response and endpoint status.',
  )
  requireMatch(
    workflow,
    /http_status.*(?:200.*207|207.*200)/,
    'Image cleanup workflow must explicitly handle the 200/207 response contract.',
  )
  requireMatch(
    workflow,
    /\(keys \| sort\) == \[[\s\S]*"deadLettersOutstanding"[\s\S]*"requestId"[\s\S]*"storageAccountingConsistent"[\s\S]*\]/,
    'Image cleanup workflow must validate the complete JSON response shape.',
  )
  requireMatch(
    workflow,
    /\.claimed == \(\.deleted \+ \.retried \+ \.deadLettered\)/,
    'Image cleanup workflow must verify deletion count conservation.',
  )
  requireMatch(
    workflow,
    /requestId \| type == "string"[\s\S]*deadLettersOutstanding/,
    'Image cleanup workflow must fail visibly when deletion dead letters remain.',
  )
  requireMatch(
    workflow,
    /storageAccountingConsistent \| type\) == "boolean"[\s\S]*storageAccountingConsistent == false[\s\S]*::error title=WebChat image Storage accounting drift/,
    'Image cleanup workflow must validate Storage accounting and fail visibly on drift.',
  )
  requireMatch(
    workflow,
    /GITHUB_STEP_SUMMARY[\s\S]*::error title=WebChat image cleanup dead letter/,
    'Image cleanup workflow must leave a bounded summary and actionable dead-letter annotations.',
  )
  return true
}

export function verifyCiWorkflow(
  workflow,
  packageJson,
  pgTapFiles,
  migrationFiles = [],
  deployWorkflow = '',
  supabaseConfig = '',
  imageCleanupWorkflow = '',
) {
  requireMatch(
    workflow,
    /- name: Check encrypted restore drill workflow invariants\s+run: npm run check:restore-drill-workflow/,
    'CI must enforce the encrypted restore drill workflow invariants.',
  )
  if (
    packageJson.scripts?.['check:restore-drill-workflow'] !==
    'node scripts/check-database-restore-drill-workflow.mjs'
  ) {
    throw new Error('The restore drill workflow checker must use the checked-in verifier.')
  }

  const denoCheckStep = extractStep(workflow, 'Check Edge Functions')
  for (const entrypoint of [
    'sync-member',
    'sync-stats',
    'delete-account',
    'change-password',
    'webchat',
    'webchat-attachment',
    'webchat-image-cleanup',
    'webchat-config',
    'webchat-cache-probe',
    'firecrawl-config',
  ]) {
    requireMatch(
      denoCheckStep,
      new RegExp(`supabase/functions/${entrypoint}/index\\.ts`),
      `CI must type-check the ${entrypoint} Edge Function entrypoint.`,
    )
    const functionConfig =
      supabaseConfig.match(
        new RegExp(`\\[functions\\.${entrypoint}\\][\\s\\S]*?(?=\\r?\\n\\[|$)`),
      )?.[0] ?? ''
    requireMatch(
      functionConfig,
      /\bverify_jwt\s*=\s*true\b/,
      `The ${entrypoint} Edge Function must enable JWT verification.`,
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
    /- name: Test account-deletion transaction fencing\s+run: npm run check:account-deletion-concurrency/,
    'Database CI must execute the real two-connection account-deletion fencing check.',
  )
  if (
    packageJson.scripts?.['check:account-deletion-concurrency'] !==
    'node scripts/check-account-deletion-concurrency.mjs'
  ) {
    throw new Error('The account-deletion concurrency check must use the checked-in verifier.')
  }
  requireMatch(
    workflow,
    /database-security:[\s\S]*?- name: Set up Deno for database integration checks\s+uses: denoland\/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed[\s\S]*?deno-version: v2\.x/,
    'Database CI must install the pinned Deno runtime used by the local outage integration check.',
  )
  requireMatch(
    workflow,
    /- name: Test single-platform outage isolation\s+run: npm run check:sync-platform-outage/,
    'Database CI must execute the single-platform outage isolation check.',
  )
  if (
    packageJson.scripts?.['check:sync-platform-outage'] !==
    'node scripts/check-sync-platform-outage.mjs'
  ) {
    throw new Error('The single-platform outage check must use the checked-in verifier.')
  }
  requireMatch(
    workflow,
    /- name: Lint database schema[\s\S]*?supabase@2\.109\.1 db lint --local[\s\S]*?--schema public --level warning --fail-on warning/,
    'Database CI must reject public schema lint warnings with the pinned Supabase CLI.',
  )
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
  const webChatUiBindings = [
    ...deployWorkflow.matchAll(
      /VITE_WEBCHAT_UI_ENABLED:\s+\$\{\{ vars\.VITE_WEBCHAT_UI_ENABLED \|\| 'false' \}\}/g,
    ),
  ]
  if (webChatUiBindings.length < 2) {
    throw new Error(
      'Pages deployment must validate and build with the explicit VITE_WEBCHAT_UI_ENABLED repository variable.',
    )
  }
  requireMatch(
    deployWorkflow,
    /VITE_WEBCHAT_UI_ENABLED must be exactly true or false/,
    'Pages deployment must reject malformed WebChat UI feature flags.',
  )
  const webChatImageInputBindings = [
    ...deployWorkflow.matchAll(
      /VITE_WEBCHAT_IMAGE_INPUT_ENABLED:\s+\$\{\{ vars\.VITE_WEBCHAT_IMAGE_INPUT_ENABLED \|\| 'false' \}\}/g,
    ),
  ]
  if (webChatImageInputBindings.length < 2) {
    throw new Error(
      'Pages deployment must validate and build with the default-disabled VITE_WEBCHAT_IMAGE_INPUT_ENABLED repository variable.',
    )
  }
  requireMatch(
    deployWorkflow,
    /VITE_WEBCHAT_IMAGE_INPUT_ENABLED must be exactly true or false/,
    'Pages deployment must reject malformed WebChat image input feature flags.',
  )
  const registrationTurnstileBindings = [
    ...deployWorkflow.matchAll(
      /VITE_REGISTRATION_TURNSTILE_ENABLED:\s+\$\{\{ vars\.VITE_REGISTRATION_TURNSTILE_ENABLED \|\| 'false' \}\}/g,
    ),
  ]
  if (registrationTurnstileBindings.length < 2) {
    throw new Error(
      'Pages deployment must validate and build with the default-disabled registration Turnstile variable.',
    )
  }
  const turnstileSiteKeyBindings = [
    ...deployWorkflow.matchAll(
      /VITE_TURNSTILE_SITE_KEY:\s+\$\{\{ vars\.VITE_TURNSTILE_SITE_KEY \|\| '' \}\}/g,
    ),
  ]
  if (turnstileSiteKeyBindings.length < 2) {
    throw new Error(
      'Pages deployment must validate and build with the public Turnstile site key variable.',
    )
  }
  requireMatch(
    deployWorkflow,
    /VITE_REGISTRATION_TURNSTILE_ENABLED must be exactly true or false/,
    'Pages deployment must reject malformed registration Turnstile flags.',
  )
  requireMatch(
    deployWorkflow,
    /VITE_TURNSTILE_SITE_KEY is required when registration Turnstile is enabled/,
    'Pages deployment must fail closed when Turnstile is enabled without a site key.',
  )

  if (imageCleanupWorkflow) verifyWebchatImageCleanupWorkflow(imageCleanupWorkflow)

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
    imageCleanupWorkflow,
    entries,
    migrationEntries,
  ] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(deployWorkflowUrl, 'utf8'),
    readFile(packageUrl, 'utf8'),
    readFile(supabaseConfigUrl, 'utf8'),
    readFile(databaseTypesUrl, 'utf8'),
    readFile(imageCleanupWorkflowUrl, 'utf8'),
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
    imageCleanupWorkflow,
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
