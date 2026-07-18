import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyDatabaseRestoreDrillWorkflow } from './check-database-restore-drill-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/database-restore-drill.yml'), 'utf8')

describe('encrypted database restore drill workflow', () => {
  it('accepts the checked-in isolated and sanitized workflow', () => {
    expect(verifyDatabaseRestoreDrillWorkflow(workflow)).toEqual({
      manualOnly: true,
      aggregateCounts: 7,
      retentionDays: 14,
    })
  })

  it('rejects automatic or pull-request execution', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '  workflow_dispatch:',
          "  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch:",
        ),
      ),
    ).toThrow(/never run automatically/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'),
      ),
    ).toThrow(/untrusted code events/)
  })

  it('rejects production Supabase access', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'BACKUP_RUN_ID: ${{ inputs.backup_run_id }}',
          'SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}',
        ),
      ),
    ).toThrow(/must not hold production Supabase access/)
  })

  it('rejects source workflow or branch substitution', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('.head_branch == "main"', '.head_branch == "feature"'),
      ),
    ).toThrow(/trusted backup-source validation/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '.path == ".github/workflows/database-backup.yml"',
          '.path == ".github/workflows/other.yml"',
        ),
      ),
    ).toThrow(/trusted backup-source validation/)
  })

  it('rejects weakened encryption or missing recovery-floor validation', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256',
          'openssl enc -d -aes-256-cbc',
        ),
      ),
    ).toThrow(/approved backup decryption/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('node scripts/verify-backup-recovery-floor.mjs', 'echo skipped'),
      ),
    ).toThrow(/recovery floor/)
  })

  it('rejects incomplete or non-atomic restore coverage', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('--file "$restore_dir/auth-data.sql"', '--file "$restore_dir/data.sql"'),
      ),
    ).toThrow(/atomically restore/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(workflow.replace('--single-transaction', '')),
    ).toThrow(/atomically restore/)
  })

  it('rejects missing Auth login or RLS smoke checks', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('auth/v1/token?grant_type=password', 'auth/v1/health'),
      ),
    ).toThrow(/Auth\/RLS/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('rest/v1/public_members?select=id&limit=1', 'rest/v1/health'),
      ),
    ).toThrow(/Auth\/RLS/)
  })

  it('rejects plaintext or credential artifact uploads', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'path: artifacts/database-restore-drill.json',
          'path: ${{ runner.temp }}/restored-backup',
        ),
      ),
    ).toThrow(/sanitized JSON report/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'path: artifacts/database-restore-drill.json',
          'path: artifacts/canary-response.json',
        ),
      ),
    ).toThrow(/sanitized JSON report/)
  })
})
