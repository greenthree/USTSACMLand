import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  verifyCiWorkflow,
  verifyDatabaseTypes,
  verifyWebchatImageCleanupWorkflow,
} from './check-ci-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
const deployWorkflow = readFileSync(resolve('.github/workflows/deploy-pages.yml'), 'utf8')
const imageCleanupWorkflow = readFileSync(
  resolve('.github/workflows/webchat-image-cleanup.yml'),
  'utf8',
)
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const supabaseConfig = readFileSync(resolve('supabase/config.toml'), 'utf8')
const databaseTypes = readFileSync(resolve('src/types/database.ts'), 'utf8')
const migrationFiles = readdirSync(resolve('supabase/migrations')).filter((name) =>
  name.endsWith('.sql'),
)
const pgTapFiles = readdirSync(resolve('supabase/tests'))
  .filter((name) => name.endsWith('.test.sql'))
  .map((name) => ({
    name,
    content: readFileSync(resolve('supabase/tests', name), 'utf8'),
  }))

describe('CI workflow', () => {
  it('accepts the checked-in least-privilege Edge and empty-database test path', () => {
    expect(
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
        imageCleanupWorkflow,
      ),
    ).toEqual({
      fileCount: 48,
      assertionCount: 1205,
      releaseMigrationCount: 53,
    })
  })

  it('protects the production WebChat image cleanup workflow contract', () => {
    expect(verifyWebchatImageCleanupWorkflow(imageCleanupWorkflow)).toBe(true)
    expect(() =>
      verifyWebchatImageCleanupWorkflow(
        imageCleanupWorkflow.replace("qzggoqdmsvktrtnjislw'", "not-production-ref'"),
      ),
    ).toThrow(/pinned to the production Supabase project ref/)
    expect(() =>
      verifyWebchatImageCleanupWorkflow(
        imageCleanupWorkflow.replaceAll('set -euo pipefail', 'set -e'),
      ),
    ).toThrow(/fail closed/)
    expect(() =>
      verifyWebchatImageCleanupWorkflow(
        imageCleanupWorkflow.replace('.claimed == (.deleted + .retried + .deadLettered)', 'true'),
      ),
    ).toThrow(/count conservation/)
    expect(() =>
      verifyWebchatImageCleanupWorkflow(
        imageCleanupWorkflow.replaceAll('storageAccountingConsistent', 'storageAccountingSkipped'),
      ),
    ).toThrow(/complete JSON response shape|Storage accounting/)
    expect(() =>
      verifyWebchatImageCleanupWorkflow(
        imageCleanupWorkflow.replace("vars.WEBCHAT_IMAGE_CLEANUP_ENABLED == 'true'", 'true'),
      ),
    ).toThrow(/explicitly enabled/)
  })

  it('requires warning-level public schema lint in database CI', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace(
          '      - name: Lint database schema\n        run: >-\n          npx --yes supabase@2.109.1 db lint --local\n          --schema public --level warning --fail-on warning\n\n',
          '',
        ),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/reject public schema lint warnings/)
  })

  it('requires the two-connection account-deletion fencing check', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace(
          '      - name: Test account-deletion transaction fencing\n        run: npm run check:account-deletion-concurrency\n\n',
          '',
        ),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/two-connection account-deletion fencing/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        {
          ...packageJson,
          scripts: {
            ...packageJson.scripts,
            'check:account-deletion-concurrency': 'echo skipped',
          },
        },
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/checked-in verifier/)
  })

  it('requires the local single-platform outage integration check', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace(
          '      - name: Test single-platform outage isolation\n        run: npm run check:sync-platform-outage\n\n',
          '',
        ),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/single-platform outage isolation/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        {
          ...packageJson,
          scripts: {
            ...packageJson.scripts,
            'check:sync-platform-outage': 'echo skipped',
          },
        },
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/single-platform outage check must use the checked-in verifier/)
  })

  it('requires the encrypted restore drill workflow checker', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace(
          '      - name: Check encrypted restore drill workflow invariants\n        run: npm run check:restore-drill-workflow\n\n',
          '',
        ),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/restore drill workflow invariants/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        {
          ...packageJson,
          scripts: {
            ...packageJson.scripts,
            'check:restore-drill-workflow': 'echo skipped',
          },
        },
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/checked-in verifier/)
  })

  it('rejects removal of the environment permission required by Edge tests', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace(' --allow-env', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/environment access/)
  })

  it('requires every security-sensitive Edge Function entrypoint to be checked', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/change-password/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/change-password Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/webchat/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/webchat Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/webchat-config/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/webchat-config Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/webchat-cache-probe/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/webchat-cache-probe Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/firecrawl-config/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/firecrawl-config Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/webchat-attachment/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/webchat-attachment Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('          supabase/functions/webchat-image-cleanup/index.ts\n', ''),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/webchat-image-cleanup Edge Function/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace('[functions.webchat]\nverify_jwt = true', '[functions.webchat]'),
      ),
    ).toThrow(/webchat Edge Function must enable JWT verification/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace(
          '[functions.webchat-config]\nverify_jwt = true',
          '[functions.webchat-config]',
        ),
      ),
    ).toThrow(/webchat-config Edge Function must enable JWT verification/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace(
          '[functions.webchat-cache-probe]\nverify_jwt = true',
          '[functions.webchat-cache-probe]',
        ),
      ),
    ).toThrow(/webchat-cache-probe Edge Function must enable JWT verification/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace(
          '[functions.firecrawl-config]\nverify_jwt = true',
          '[functions.firecrawl-config]',
        ),
      ),
    ).toThrow(/firecrawl-config Edge Function must enable JWT verification/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace(
          '[functions.webchat-attachment]\nverify_jwt = true',
          '[functions.webchat-attachment]',
        ),
      ),
    ).toThrow(/webchat-attachment Edge Function must enable JWT verification/)
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace(
          '[functions.webchat-image-cleanup]\nverify_jwt = true',
          '[functions.webchat-image-cleanup]',
        ),
      ),
    ).toThrow(/webchat-image-cleanup Edge Function must enable JWT verification/)
  })

  it('rejects unrestricted or network-capable Edge unit tests', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('--allow-read --allow-env', '--allow-all'),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/read access|unrestricted/)
    expect(() =>
      verifyCiWorkflow(
        workflow.replace('--allow-read --allow-env', '--allow-read --allow-env --allow-net'),
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/must not contact the network/)
  })

  it('rejects an unpinned or narrowed database test command', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow,
        {
          ...packageJson,
          scripts: {
            ...packageJson.scripts,
            'test:db': 'supabase test db supabase/tests/01_security_catalog.test.sql',
          },
        },
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/complete checked-in pgTAP directory/)
  })

  it('rejects missing pgTAP files and regressed assertion coverage', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles.slice(1),
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/contiguous|at least 26 pgTAP files/)
    const regressed = pgTapFiles.map((file) =>
      file.name === '13_non_luogu_atomic_persistence.test.sql'
        ? { ...file, content: file.content.replace('select plan(27);', 'select plan(1);') }
        : file,
    )
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        regressed,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/recognized assertion calls/)
  })

  it('protects the current release migration set and CI-gated Pages deployment', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter(
          (name) => name !== '202607160009_allow_pending_luogu_failure_commit.sql',
        ),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607160009_allow_pending_luogu_failure_commit/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607170006_webchat_relay_admin_config.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607170006_webchat_relay_admin_config/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607170007_webchat_budget_monitoring.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607170007_webchat_budget_monitoring/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607170008_webchat_member_access.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607170008_webchat_member_access/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607170009_webchat_admin_access.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607170009_webchat_admin_access/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607170010_webchat_model_visibility.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607170010_webchat_model_visibility/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607180001_daily_problem_learning.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607180001_daily_problem_learning/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607180003_webchat_total_member_quotas.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607180003_webchat_total_member_quotas/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter(
          (name) => name !== '202607180004_public_practice_increment_rankings.sql',
        ),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607180004_public_practice_increment_rankings/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607180005_webchat_conversation_history.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607180005_webchat_conversation_history/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607180006_webchat_cache_probe_accounting.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607180006_webchat_cache_probe_accounting/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607190005_personal_data_export.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607190005_personal_data_export/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607200001_sync_single_retry.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607200001_sync_single_retry/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles.filter((name) => name !== '202607200002_clear_public_schema_lint.sql'),
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/202607200002_clear_public_schema_lint/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace('workflow_run:', 'push:'),
        supabaseConfig,
      ),
    ).toThrow(/triggered by completion|independent push trigger/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace(
          "VITE_WEBCHAT_UI_ENABLED: ${{ vars.VITE_WEBCHAT_UI_ENABLED || 'false' }}",
          'VITE_WEBCHAT_UI_ENABLED: false',
        ),
        supabaseConfig,
      ),
    ).toThrow(/explicit VITE_WEBCHAT_UI_ENABLED repository variable/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace(
          "VITE_WEBCHAT_IMAGE_INPUT_ENABLED: ${{ vars.VITE_WEBCHAT_IMAGE_INPUT_ENABLED || 'false' }}",
          'VITE_WEBCHAT_IMAGE_INPUT_ENABLED: true',
        ),
        supabaseConfig,
      ),
    ).toThrow(/default-disabled VITE_WEBCHAT_IMAGE_INPUT_ENABLED repository variable/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace(
          'VITE_WEBCHAT_IMAGE_INPUT_ENABLED must be exactly true or false.',
          'invalid image flags are accepted',
        ),
        supabaseConfig,
      ),
    ).toThrow(/malformed WebChat image input feature flags/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace(
          "VITE_REGISTRATION_TURNSTILE_ENABLED: ${{ vars.VITE_REGISTRATION_TURNSTILE_ENABLED || 'false' }}",
          'VITE_REGISTRATION_TURNSTILE_ENABLED: false',
        ),
        supabaseConfig,
      ),
    ).toThrow(/default-disabled registration Turnstile variable/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace(
          "VITE_TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY || '' }}",
          'VITE_TURNSTILE_SITE_KEY: omitted',
        ),
        supabaseConfig,
      ),
    ).toThrow(/public Turnstile site key variable/)

    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow.replace(
          'VITE_TURNSTILE_SITE_KEY is required when registration Turnstile is enabled.',
          'missing Turnstile site keys are accepted',
        ),
        supabaseConfig,
      ),
    ).toThrow(/fail closed when Turnstile is enabled without a site key/)

    for (const migration of [
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
    ]) {
      expect(() =>
        verifyCiWorkflow(
          workflow,
          packageJson,
          pgTapFiles,
          migrationFiles.filter((name) => name !== migration),
          deployWorkflow,
          supabaseConfig,
        ),
      ).toThrow(new RegExp(migration.replace('.', '\\.')))
    }
  })

  it('requires the local database used by CI to match production PostgreSQL 17', () => {
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace('major_version = 17', 'major_version = 15'),
      ),
    ).toThrow(/PostgreSQL 17/)
  })

  it('rejects inflated pgTAP plans that do not match real assertion calls', () => {
    const inflated = pgTapFiles.map((file) =>
      file.name === '02_rls_identity_matrix.test.sql'
        ? { ...file, content: file.content.replace('select plan(22);', 'select plan(23);') }
        : file,
    )
    expect(() =>
      verifyCiWorkflow(
        workflow,
        packageJson,
        inflated,
        migrationFiles,
        deployWorkflow,
        supabaseConfig,
      ),
    ).toThrow(/recognized assertion calls/)
  })

  it('protects generated types for service-only tables and privileged RPCs', () => {
    expect(() => verifyDatabaseTypes(databaseTypes)).not.toThrow()
    expect(() =>
      verifyDatabaseTypes(databaseTypes.replace('xcpc_elo_cache_state:', 'removed_cache_state:')),
    ).toThrow(/xcpc_elo_cache_state/)
    expect(() =>
      verifyDatabaseTypes(databaseTypes.replace('daily_problems:', 'removed_daily_problems:')),
    ).toThrow(/daily_problems/)
    expect(() =>
      verifyDatabaseTypes(
        databaseTypes.replace('read_daily_problem_feed:', 'removed_daily_problem_feed:'),
      ),
    ).toThrow(/read_daily_problem_feed/)
    expect(() =>
      verifyDatabaseTypes(databaseTypes.replace('export_own_data:', 'removed_export_own_data:')),
    ).toThrow(/export_own_data/)
    expect(() =>
      verifyDatabaseTypes(
        databaseTypes.replace(
          'reserve_webchat_image_attachment:',
          'removed_reserve_webchat_image_attachment:',
        ),
      ),
    ).toThrow(/reserve_webchat_image_attachment/)
    expect(() =>
      verifyDatabaseTypes(
        databaseTypes.replace(
          'purge_deleted_webchat_image_attachments:',
          'removed_purge_deleted_webchat_image_attachments:',
        ),
      ),
    ).toThrow(/purge_deleted_webchat_image_attachments/)
    expect(() =>
      verifyDatabaseTypes(
        databaseTypes.replace(
          'reconcile_webchat_image_storage_accounting:',
          'removed_reconcile_webchat_image_storage_accounting:',
        ),
      ),
    ).toThrow(/reconcile_webchat_image_storage_accounting/)
    expect(() =>
      verifyDatabaseTypes(
        databaseTypes.replaceAll('requested_total_request_limit:', 'removed_total_request_limit:'),
      ),
    ).toThrow(/requested_total_request_limit/)
    expect(() =>
      verifyDatabaseTypes(`${databaseTypes}\nadmin_update_webchat_member_policy: { Args: never }`),
    ).toThrow(/pilot policy API/)
    expect(() =>
      verifyDatabaseTypes(
        `${databaseTypes}\nadmin_read_webchat_pilot_observation: { Args: never }`,
      ),
    ).toThrow(/observation API/)
    expect(() =>
      verifyDatabaseTypes(`${databaseTypes}\nrequested_daily_request_limit: number`),
    ).toThrow(/daily member quota API/)
  })
})
