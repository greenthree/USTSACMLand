import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyDatabaseBackupWorkflow } from './check-database-backup-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/database-backup.yml'), 'utf8')

describe('encrypted database backup workflow', () => {
  it('accepts the checked-in workflow and reports its recovery coverage', () => {
    expect(verifyDatabaseBackupWorkflow(workflow)).toEqual({ dumpCount: 6, retentionDays: 14 })
  })

  it('rejects removal of authenticated-user data from the backup', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('--schema auth', '--schema public')),
    ).toThrow(/--schema auth/)
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

  it('rejects plaintext artifact uploads', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '${{ runner.temp }}/ustsacmland-database-backup.enc',
          '${{ runner.temp }}/ustsacmland-database-backup.tar.gz',
        ),
      ),
    ).toThrow(/exactly the encrypted archive and checksum/)
  })

  it('rejects any additional artifact path even when the encrypted files remain', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          '            ${{ runner.temp }}/ustsacmland-database-backup.enc.sha256',
          '            ${{ runner.temp }}/ustsacmland-database-backup.enc.sha256\n            ${{ runner.temp }}/unexpected-file',
        ),
      ),
    ).toThrow(/exactly the encrypted archive and checksum/)
  })

  it('rejects weaker or removed archive encryption', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace(
          'openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -md sha256',
          'openssl enc -aes-256-cbc',
        ),
      ),
    ).toThrow(/approved PBKDF2 parameters/)
  })

  it('rejects unpinned Supabase CLI versions', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replaceAll('supabase@2.109.1', 'supabase@latest')),
    ).toThrow(/six pinned Supabase CLI dumps/)
  })

  it('rejects a long-lived database URL in place of linked credentials', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(workflow.replace('--linked', '--db-url "$SUPABASE_DB_URL"')),
    ).toThrow(/short-lived linked credentials/)
  })

  it('rejects execution on pull-request events', () => {
    expect(() =>
      verifyDatabaseBackupWorkflow(
        workflow.replace('  workflow_dispatch:', '  workflow_dispatch:\n  pull_request:'),
      ),
    ).toThrow(/untrusted push or pull-request events/)
  })
})
