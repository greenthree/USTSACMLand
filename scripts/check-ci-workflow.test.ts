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
      fileCount: 18,
      assertionCount: 328,
      releaseMigrationCount: 24,
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
        workflow,
        packageJson,
        pgTapFiles,
        migrationFiles,
        deployWorkflow,
        supabaseConfig.replace('[functions.webchat]\nverify_jwt = true', '[functions.webchat]'),
      ),
    ).toThrow(/webchat Edge Function must enable JWT verification/)
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
    ).toThrow(/at least 18 pgTAP files/)
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
        migrationFiles,
        deployWorkflow.replace('workflow_run:', 'push:'),
        supabaseConfig,
      ),
    ).toThrow(/triggered by completion|independent push trigger/)
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

  it('protects generated types for service-only cache tables and atomic RPCs', () => {
    expect(() => verifyDatabaseTypes(databaseTypes)).not.toThrow()
    expect(() =>
      verifyDatabaseTypes(databaseTypes.replace('xcpc_elo_cache_state:', 'removed_cache_state:')),
    ).toThrow(/xcpc_elo_cache_state/)
  })
})
