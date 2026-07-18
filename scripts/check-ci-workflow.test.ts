import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyCiWorkflow, verifyDatabaseTypes } from './check-ci-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
const deployWorkflow = readFileSync(resolve('.github/workflows/deploy-pages.yml'), 'utf8')
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
      ),
    ).toEqual({
      fileCount: 30,
      assertionCount: 738,
      releaseMigrationCount: 35,
    })
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
      verifyDatabaseTypes(
        databaseTypes.replace('requested_total_request_limit:', 'removed_total_request_limit:'),
      ),
    ).toThrow(/requested_total_request_limit/)
    expect(() =>
      verifyDatabaseTypes(`${databaseTypes}\nrequested_daily_request_limit: number`),
    ).toThrow(/daily member quota API/)
  })
})
