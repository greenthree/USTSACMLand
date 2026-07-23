import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyDatabaseRestoreDrillWorkflow } from './check-database-restore-drill-workflow.mjs'

const workflow = readFileSync(resolve('.github/workflows/database-restore-drill.yml'), 'utf8')

describe('encrypted database and WebChat Storage restore drill workflow', () => {
  it('accepts the checked-in isolated and sanitized workflow', () => {
    expect(verifyDatabaseRestoreDrillWorkflow(workflow)).toEqual({
      manualOnly: true,
      aggregateCounts: 8,
      storageVerification: true,
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

  it('rejects production Supabase access and disabled local Storage', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'BACKUP_RUN_ID: ${{ inputs.backup_run_id }}',
          'SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}',
        ),
      ),
    ).toThrow(/must not hold production Supabase access/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '--exclude analytics,edge-runtime,functions,imgproxy,inbucket,realtime,studio,vector',
          '--exclude analytics,edge-runtime,functions,imgproxy,inbucket,realtime,storage,studio,vector',
        ),
      ),
    ).toThrow(/keeping Storage|Storage service enabled/)
  })

  it('keeps the decryption secret out of the job-wide environment', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '    steps:',
          '    env:\n      BACKUP_ENCRYPTION_PASSPHRASE: ${{ secrets.BACKUP_ENCRYPTION_PASSPHRASE }}\n    steps:',
        ),
      ),
    ).toThrow(/scoped only to the shell step/)
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

  it('requires dynamic Storage archive validation before extraction', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('node scripts/verify-webchat-storage-backup.mjs listing', 'echo skipped'),
      ),
    ).toThrow(/dynamically verify/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          "'./storage/webchat-images/manifest.ndjson'",
          "'./storage/webchat-images/missing.ndjson'",
        ),
      ),
    ).toThrow(/extract the Storage manifest|strict Storage-free v1/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(workflow.replace('diff -u <(printf', 'diff -u <(printf')),
    ).not.toThrow()
  })

  it('keeps legacy v1 compatibility strict and distinguishes uninstalled v2 snapshots', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('&& ! grep -Eq \'^\\./storage/\' "$listing"; then', '; then'),
      ),
    ).toThrow(/strict Storage-free v1/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('(.schemaVersion == 1 and .storage == null)', '(.schemaVersion == 1)'),
      ),
    ).toThrow(/legacy v1|feature-state-aware v2/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'jq -n \'{featureInstalled: false}\' > "$storage_boundary"',
          'jq -n \'{}\' > "$storage_boundary"',
        ),
      ),
    ).toThrow(/distinguish uninstalled v2/)
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
        workflow.replace('verify-backup-recovery-floor.mjs', 'echo skipped-recovery-floor'),
      ),
    ).toThrow(/recovery floor/)
  })

  it('rejects incomplete or non-atomic database restore coverage', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '--file "$container_restore/auth-data.sql"',
          '--file "$container_restore/data.sql"',
        ),
      ),
    ).toThrow(/atomically restore/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(workflow.replace('--single-transaction', '')),
    ).toThrow(/atomically restore/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('            --file "$container_restore/auth-hooks.sql" \\\n', ''),
      ),
    ).toThrow(/Auth hooks|atomically restore/)
  })

  it('requires private bucket setup, immutable object upload, and local download', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(workflow.replace('insert into storage.buckets', 'select')),
    ).toThrow(/private WebChat bucket/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replaceAll("--header 'x-upsert: false'", "--header 'x-upsert: true'"),
      ),
    ).toThrow(/immutable WebChat object/)
    expect(() => verifyDatabaseRestoreDrillWorkflow(workflow.replace('--local \\\n', ''))).toThrow(
      /local CLI/,
    )
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replaceAll(
          'node scripts/verify-webchat-storage-restore.mjs',
          'echo skipped-storage-verify',
        ),
      ),
    ).toThrow(/compare restored object/)
  })

  it('requires empty-bucket privacy probe and both anonymous access checks', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace("probe_path='restore-boundary-canary.webp'", "probe_path='missing.webp'"),
      ),
    ).toThrow(/disposable probe/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'Authorization: Bearer $ANON_KEY',
          'Authorization: Bearer $SERVICE_ROLE_KEY',
        ),
      ),
    ).toThrow(/anonymous Storage probe|anonymous Storage access modes/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('^(400|401|403|404)$', '^(400|401|403|404|500)$'),
      ),
    ).toThrow(/explicit expected anonymous Storage 4xx statuses/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          'jq -r -s \'first(.[] | .path) // empty\' "$storage_source/manifest.ndjson"',
          'jq -r \'.path\' "$storage_source/manifest.ndjson" | head -n 1',
        ),
      ),
    ).toThrow(/jq with head|SIGPIPE/)
  })

  it('requires image row counts, orphan checks, and sanitized Storage observation merge', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '. + {webchatImageAttachments: $count}',
          '. + {removedImageAttachments: $count}',
        ),
      ),
    ).toThrow(/image attachment row counts/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('webchatImagesWithoutConversation', 'removedConversationCheck'),
      ),
    ).toThrow(/WebChat image relational orphans/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('authUsersWithoutProfile', 'removedAuthProfileCheck'),
      ),
    ).toThrow(/Auth users|relational orphans/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('private.webchat_conversations', 'public.webchat_conversations'),
      ),
    ).toThrow(/deletion tombstones/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          "a.status in ('reserved', 'validating', 'ready', 'attached', 'failed')",
          "a.status not in ('deleted')",
        ),
      ),
    ).toThrow(/deletion tombstones/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('--slurpfile storageObservation "$storage_observation"', ''),
      ),
    ).toThrow(/sanitized aggregate Storage result/)
  })

  it('rejects missing Auth or RLS smoke checks', () => {
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
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('type == "array" and length == 0', 'type == "array"'),
      ),
    ).toThrow(/strictly empty RLS-filtered/)
  })

  it('requires restore SQL output to stay out of the Actions log', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace('            > "$restore_psql_log" 2>&1; then\n', '            ; then\n'),
      ),
    ).toThrow(/Restore SQL output/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          "          echo '::notice::Restore transaction completed.'",
          '          cat "$restore_psql_log"',
        ),
      ),
    ).toThrow(/never be replayed/)
  })

  it('requires a validated UUID and disposable container cleanup', () => {
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace("= '$canary_id'::uuid", "= :'canary_id'::uuid"),
      ),
    ).toThrow(/canary UUID/)
    expect(() =>
      verifyDatabaseRestoreDrillWorkflow(
        workflow.replace(
          '          docker exec "$db_container" rm -rf "$container_restore"\n          trap - EXIT',
          '          trap - EXIT',
        ),
      ),
    ).toThrow(/copied into the disposable database container/)
  })

  it('rejects plaintext or credential artifact uploads and requires cleanup', () => {
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
        workflow.replaceAll('restored-storage-download', 'published-storage-download'),
      ),
    ).toThrow(/remove and verify all restored Storage/)
  })
})
