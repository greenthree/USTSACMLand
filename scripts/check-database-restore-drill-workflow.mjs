import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/database-restore-drill.yml', import.meta.url)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

export function verifyDatabaseRestoreDrillWorkflow(workflow) {
  requireMatch(
    workflow,
    /^\s{2}workflow_dispatch:\s*$/m,
    'Restore drill must be a controlled manual workflow.',
  )
  if (/^\s{2}(?:schedule|push|pull_request):\s*$/m.test(workflow)) {
    throw new Error('Restore drill must never run automatically or for untrusted code events.')
  }
  requireMatch(
    workflow,
    /^\s{2}actions:\s*read\s*$/m,
    'Restore drill needs read-only Actions access.',
  )
  requireMatch(
    workflow,
    /^\s{2}contents:\s*read\s*$/m,
    'Restore drill needs read-only contents access.',
  )
  if (/\b(?:contents|actions):\s*write\b/.test(workflow)) {
    throw new Error('Restore drill must not receive repository write permissions.')
  }

  requireMatch(
    workflow,
    /BACKUP_ENCRYPTION_PASSPHRASE:\s*\$\{\{ secrets\.BACKUP_ENCRYPTION_PASSPHRASE \}\}/,
    'Restore decryption must use the existing Actions Secret.',
  )
  requireMatch(
    workflow,
    /BACKUP_RECOVERY_NOT_BEFORE:\s*\$\{\{ vars\.BACKUP_RECOVERY_NOT_BEFORE \|\| '1970-01-01T00:00:00\.000Z' \}\}/,
    'Restore drill must enforce the current account-deletion recovery floor.',
  )
  if (
    /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF|RESTORE_DB_URL|--linked|--project-ref/.test(
      workflow,
    )
  ) {
    throw new Error(
      'Restore drill must not hold production Supabase access or target a remote database.',
    )
  }

  for (const fragment of [
    '.name == "Encrypted database backup"',
    '.head_branch == "main"',
    '.head_repository.full_name == $repository',
    '.conclusion == "success"',
    '.path == ".github/workflows/database-backup.yml"',
    '.expired == false',
    'artifact_name="ustsacmland-database-backup-$BACKUP_RUN_ID-$run_attempt"',
  ]) {
    if (!workflow.includes(fragment)) {
      throw new Error(`Restore drill is missing trusted backup-source validation: ${fragment}`)
    }
  }

  requireMatch(
    workflow,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/,
    'Restore download action must be pinned to the reviewed v8.0.1 commit.',
  )
  requireMatch(
    workflow,
    /run-id:\s*\$\{\{ inputs\.backup_run_id \}\}/,
    'Restore drill must download the explicitly validated backup run.',
  )
  requireMatch(
    workflow,
    /name:\s*\$\{\{ steps\.source\.outputs\.artifact_name \}\}/,
    'Restore drill must download the exact validated backup artifact.',
  )

  requireMatch(
    workflow,
    /openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256/,
    'Restore drill must use the approved backup decryption parameters.',
  )
  requireMatch(
    workflow,
    /sha256sum -c ustsacmland-database-backup\.enc\.sha256/,
    'Restore drill must verify the encrypted artifact checksum.',
  )
  requireMatch(
    workflow,
    /sha256sum -c SHA256SUMS/,
    'Restore drill must verify every decrypted file checksum.',
  )
  for (const file of [
    'roles.sql',
    'schema.sql',
    'data.sql',
    'auth-data.sql',
    'migrations-schema.sql',
    'migrations-data.sql',
    'metadata.txt',
    'restore-manifest.json',
    'SHA256SUMS',
  ]) {
    if (!workflow.includes(`'./${file}'`)) {
      throw new Error(`Restore drill archive allow-list is missing ${file}.`)
    }
  }
  requireMatch(
    workflow,
    /verify-backup-recovery-floor\.mjs "\$restore_dir\/metadata\.txt"/,
    'Restore drill must reject backups older than the current recovery floor.',
  )

  requireMatch(
    workflow,
    /mv supabase\/migrations "\$RUNNER_TEMP\/repository-migrations"/,
    'Restore drill must remove repository migrations from the isolated target baseline.',
  )
  requireMatch(
    workflow,
    /npx --yes supabase@2\.109\.1 start/,
    'Restore drill must pin the local Supabase version.',
  )
  requireMatch(
    workflow,
    /psql "\$DB_URL"[\s\S]*--single-transaction[\s\S]*--file "\$restore_dir\/roles\.sql"[\s\S]*--file "\$restore_dir\/schema\.sql"[\s\S]*--file "\$restore_dir\/data\.sql"[\s\S]*--file "\$restore_dir\/auth-data\.sql"[\s\S]*--file "\$restore_dir\/migrations-schema\.sql"[\s\S]*--file "\$restore_dir\/migrations-data\.sql"/,
    'Restore drill must atomically restore roles, schema, business data, Auth data, and migration history.',
  )
  requireMatch(
    workflow,
    /set local role supabase_auth_admin;[\s\S]*truncate table[\s\S]*reset role;[\s\S]*drop schema if exists supabase_migrations cascade;/,
    'Restore drill must use the least platform role needed to clear local Auth data.',
  )
  requireMatch(
    workflow,
    /--file "\$restore_dir\/data\.sql" \\\r?\n\s+--command 'set local role supabase_auth_admin' \\\r?\n\s+--file "\$restore_dir\/auth-data\.sql" \\\r?\n\s+--command 'reset role'/,
    'Restore drill must scope the Supabase Auth owner role only around Auth data import.',
  )

  for (const fragment of [
    'auth/v1/admin/users',
    'auth/v1/token?grant_type=password',
    'rest/v1/profiles?select=id&id=eq.$canary_id',
    'rest/v1/profiles?select=id&id=neq.$canary_id&limit=1',
    'rest/v1/public_members?select=id&limit=1',
    'anonymous_private_status',
    'verify-database-restore-drill.mjs',
  ]) {
    if (!workflow.includes(fragment)) {
      throw new Error(`Restore drill is missing Auth/RLS or aggregate verification: ${fragment}`)
    }
  }
  if (/curl[^\n]*(?:greenthree\.github\.io|supabase\.co|127\.0\.0\.1:5432[12])/i.test(workflow)) {
    throw new Error('Restore smoke requests must use only the local API URL discovered at runtime.')
  }

  requireMatch(
    workflow,
    /- name: Stop isolated local Supabase\s+if: always\(\)\s+run: npx --yes supabase@2\.109\.1 stop --no-backup/,
    'Restore drill must always destroy the isolated database without preserving state.',
  )
  requireMatch(
    workflow,
    /- name: Remove decrypted backup and temporary credentials\s+if: always\(\)/,
    'Restore drill must always remove plaintext and temporary credentials.',
  )
  requireMatch(
    workflow,
    /test ! -e "\$RUNNER_TEMP\/restored-backup"[\s\S]*test ! -e "\$RUNNER_TEMP\/ustsacmland-database-backup\.tar\.gz"/,
    'Restore drill must verify plaintext removal.',
  )

  const uploadStart = workflow.indexOf('- name: Upload sanitized restore report')
  if (uploadStart < 0) throw new Error('Restore drill is missing its sanitized report upload.')
  const uploadBlock = workflow.slice(uploadStart)
  requireMatch(
    uploadBlock,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
    'Restore report upload must use the reviewed pinned action.',
  )
  requireMatch(
    uploadBlock,
    /path:\s*artifacts\/database-restore-drill\.json/,
    'Restore drill may upload only the sanitized JSON report.',
  )
  if (/\.sql\b|\.enc\b|\.tar(?:\.gz)?\b|restored-backup|canary-/i.test(uploadBlock)) {
    throw new Error(
      'Restore report upload must never include backup data or temporary credentials.',
    )
  }
  requireMatch(uploadBlock, /retention-days:\s*14/, 'Restore evidence must expire after 14 days.')

  return { manualOnly: true, aggregateCounts: 7, retentionDays: 14 }
}

async function main() {
  const workflow = await readFile(workflowUrl, 'utf8')
  const report = verifyDatabaseRestoreDrillWorkflow(workflow)
  console.log(
    `Verified isolated database restore drill: manual-only, ${report.aggregateCounts} aggregate counts, ${report.retentionDays}-day sanitized evidence.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
