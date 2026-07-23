import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyDatabaseBackupWorkflow } from './check-database-backup-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/database-backup.yml'), 'utf8')

describe('encrypted database and WebChat Storage backup workflow', () => {
  it('accepts the checked-in workflow and reports its recovery coverage', () => {
    expect(verifyDatabaseBackupWorkflow(workflow)).toEqual({
      dumpCount: 7,
      storageCopyCount: 1,
      retentionDays: 14,
    })
  })

  it('requires Auth and application data to share one database snapshot', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('--schema public,private,auth', '--schema public,private'),
      ),
    ).toThrow(/one pg_dump snapshot|public,private,auth/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replaceAll(
          '-- Compatibility placeholder: auth data is included in data.sql.',
          '-- auth data exported elsewhere',
        ),
      ),
    ).toThrow(/compatibility placeholder|required dump coverage/)
  })

  it('requires both externally configured backup capacity gates', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replaceAll(
          'MAX_BACKUP_ARTIFACT_BYTES: ${{ vars.MAX_BACKUP_ARTIFACT_BYTES }}',
          'MAX_BACKUP_ARTIFACT_BYTES: 1000000',
        ),
      ),
    ).toThrow(/artifact size limit/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replaceAll('MAX_STORAGE_OBJECTS: ${{ vars.MAX_STORAGE_OBJECTS }}', ''),
      ),
    ).toThrow(/Storage object limit/)
  })

  it('keeps production secrets out of the job-wide environment', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '    steps:',
          '    env:\n      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n    steps:',
        ),
      ),
    ).toThrow(/scoped only to the shell steps/)
  })

  it('rejects a project reference check that accepts another Supabase project', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '"$SUPABASE_PROJECT_REF" != \'qzggoqdmsvktrtnjislw\'',
          '"$SUPABASE_PROJECT_REF" != \'aaaaaaaaaaaaaaaaaaaa\'',
        ),
      ),
    ).toThrow(/canonical production project/)
  })

  it('rejects removal of the external account-deletion recovery floor', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          'recovery_not_before=$BACKUP_RECOVERY_NOT_BEFORE',
          'recovery_not_before=1970-01-01T00:00:00.000Z',
        ),
      ),
    ).toThrow(/account-deletion recovery floor/)
  })

  it('requires a path-free pre-download plan so empty snapshots skip the CLI copy', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('node scripts/webchat-storage-backup.mjs plan', 'echo skipped-plan'),
      ),
    ).toThrow(/stage the exact|Storage download plan/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('if (( storage_object_count > 0 )); then', 'if true; then'),
      ),
    ).toThrow(/empty snapshots/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('webchat-storage-backup.mjs uninstalled', 'echo skipped-uninstalled'),
      ),
    ).toThrow(/explicit empty snapshot/)
  })

  it('requires one pinned recursive Storage download with private output redirection', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('npx --yes supabase@2.109.1 storage cp', 'echo skipped-storage-copy'),
      ),
    ).toThrow(/one pinned private Storage download/)
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('> "$storage_cli_log" 2>&1', '')),
    ).toThrow(/path-bearing output redirected/)
  })

  it('requires exact Storage staging, verification, and aggregate manifest coverage', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('node scripts/webchat-storage-backup.mjs \\', 'echo skipped-stage \\'),
      ),
    ).toThrow(/exact database-referenced/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '"$backup_dir/storage/webchat-images/summary.json" \\',
          '"$backup_dir/metadata.txt" \\',
        ),
      ),
    ).toThrow(/including Storage aggregates/)
  })

  it('requires every dynamic database and Storage file in SHA256SUMS', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('find . -type f ! -name SHA256SUMS -print0', 'printf fixed-files'),
      ),
    ).toThrow(/Every dynamic backup file/)
  })

  it('requires encrypted archive allowlisting and checksum output privacy before extraction', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          'node scripts/verify-webchat-storage-backup.mjs listing',
          'echo skipped-listing',
        ),
      ),
    ).toThrow(/self-verification|allowlist/)
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('> "$verification_checksum_log" 2>&1', '')),
    ).toThrow(/path-bearing output/)
  })

  it('rejects plaintext artifact uploads or any additional artifact path', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '${{ runner.temp }}/ustsacmland-database-backup.enc',
          '${{ runner.temp }}/ustsacmland-database-backup.tar.gz',
        ),
      ),
    ).toThrow(/exactly the encrypted archive and checksum/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '            ${{ runner.temp }}/ustsacmland-database-backup.enc.sha256',
          '            ${{ runner.temp }}/ustsacmland-database-backup.enc.sha256\n            ${{ runner.temp }}/unexpected-file',
        ),
      ),
    ).toThrow(/exactly the encrypted archive and checksum/)
  })

  it('rejects weaker encryption or removal of the encrypted size cap', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          'openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -md sha256',
          'openssl enc -aes-256-cbc',
        ),
      ),
    ).toThrow(/approved PBKDF2 parameters/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          'if (( encrypted_size > MAX_BACKUP_ARTIFACT_BYTES )); then',
          'if false; then',
        ),
      ),
    ).toThrow(/encrypted artifact exceeds/)
  })

  it('requires downloaded Storage and path-bearing logs in plaintext cleanup', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '"$backup_dir" "$verification_dir" "$storage_download_parent"',
          '"$backup_dir" "$verification_dir"',
        ),
      ),
    ).toThrow(/Plaintext cleanup|path-bearing output redirected/)
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('              "$storage_cli_log" \\\n', '')),
    ).toThrow(/Plaintext cleanup|path-bearing output redirected/)
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('              "$checksum_manifest" \\\n', '')),
    ).toThrow(/Plaintext cleanup/)
  })

  it('rejects unpinned Supabase CLI versions and long-lived credentials', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replaceAll('supabase@2.109.1', 'supabase@latest')),
    ).toThrow(/seven pinned Supabase CLI dumps/)
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('--linked', '--db-url "$SUPABASE_DB_URL"')),
    ).toThrow(/short-lived linked credentials/)
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          'SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}',
          'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
        ),
      ),
    ).toThrow(/long-lived Storage credential|project reference/)
  })

  it('requires allow-listed Auth user triggers without archiving the full Auth schema dump', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('node scripts/extract-auth-user-triggers.mjs', 'echo skipped-auth-hooks'),
      ),
    ).toThrow(/Auth user triggers|auth-hooks|required dump coverage/)
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('rm -f "$auth_schema_dump"', ':')),
    ).toThrow(/remove the full Auth schema dump/)
  })

  it('rejects execution on pull-request events', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('  workflow_dispatch:', '  workflow_dispatch:\n  pull_request:'),
      ),
    ).toThrow(/untrusted push or pull-request events/)
  })
})
