import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/database-backup.yml', import.meta.url)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

export function verifyDatabaseBackupWorkflow(workflow) {
  requireMatch(workflow, /^\s{2}schedule:\s*$/m, 'Backup workflow must run on a schedule.')
  requireMatch(
    workflow,
    /^\s{2}workflow_dispatch:\s*$/m,
    'Backup workflow must support a controlled manual run.',
  )
  if (/^\s{2}(?:push|pull_request):\s*$/m.test(workflow)) {
    throw new Error('Backup workflow must not run for untrusted push or pull-request events.')
  }

  requireMatch(
    workflow,
    /SUPABASE_DB_URL:\s*\$\{\{ secrets\.SUPABASE_DB_URL \}\}/,
    'Database connection string must come from the SUPABASE_DB_URL Actions Secret.',
  )
  requireMatch(
    workflow,
    /BACKUP_ENCRYPTION_PASSPHRASE:\s*\$\{\{ secrets\.BACKUP_ENCRYPTION_PASSPHRASE \}\}/,
    'Backup encryption passphrase must come from an Actions Secret.',
  )
  requireMatch(
    workflow,
    /BACKUP_RECOVERY_NOT_BEFORE:\s*\$\{\{ vars\.BACKUP_RECOVERY_NOT_BEFORE \|\| '1970-01-01T00:00:00\.000Z' \}\}/,
    'Backup workflow must read the external account-deletion recovery floor.',
  )
  requireMatch(
    workflow,
    /\$\{#BACKUP_ENCRYPTION_PASSPHRASE\}\s*<\s*32/,
    'Backup workflow must reject encryption passphrases shorter than 32 characters.',
  )
  requireMatch(
    workflow,
    /recovery_not_before=\$BACKUP_RECOVERY_NOT_BEFORE/,
    'Backup metadata must capture the external account-deletion recovery floor.',
  )

  const dumpCount = workflow.match(/npx --yes supabase@2\.109\.1 db dump/g)?.length ?? 0
  if (dumpCount !== 6) {
    throw new Error(
      `Backup workflow must contain six pinned Supabase CLI dumps; found ${dumpCount}.`,
    )
  }
  for (const requiredFragment of [
    '--role-only',
    '--file "$backup_dir/schema.sql"',
    '--file "$backup_dir/data.sql"',
    '--file "$backup_dir/auth-data.sql"',
    '--schema auth',
    '--file "$backup_dir/migrations-schema.sql"',
    '--file "$backup_dir/migrations-data.sql"',
    '--schema supabase_migrations',
    "--exclude 'storage.buckets_vectors'",
    "--exclude 'storage.vector_indexes'",
  ]) {
    if (!workflow.includes(requiredFragment)) {
      throw new Error(`Backup workflow is missing required dump coverage: ${requiredFragment}`)
    }
  }

  requireMatch(
    workflow,
    /openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -md sha256/,
    'Backup archive must be encrypted with the approved PBKDF2 parameters.',
  )
  requireMatch(
    workflow,
    /openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256/,
    'Backup workflow must decrypt the archive once before upload.',
  )
  const passphraseReferences =
    workflow.match(/-pass env:BACKUP_ENCRYPTION_PASSPHRASE/g)?.length ?? 0
  if (passphraseReferences !== 2) {
    throw new Error(
      'Encryption and verification must both read the passphrase from the environment.',
    )
  }
  requireMatch(
    workflow,
    /test ! -e "\$backup_dir"[\s\S]*test ! -e "\$archive"[\s\S]*test ! -e "\$verification_archive"/,
    'Plaintext backup files must be removed and verified absent before upload.',
  )

  const uploadStart = workflow.indexOf('- name: Upload encrypted backup')
  if (uploadStart < 0) throw new Error('Backup workflow is missing its encrypted artifact upload.')
  const uploadBlock = workflow.slice(uploadStart)
  requireMatch(
    uploadBlock,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
    'Backup upload action must be pinned to the reviewed v4.6.2 commit.',
  )
  const safePaths = [
    '${{ runner.temp }}/ustsacmland-database-backup.enc',
    '${{ runner.temp }}/ustsacmland-database-backup.enc.sha256',
  ]
  const pathBlock = uploadBlock.match(/^\s{10}path:\s*\|\s*\r?\n((?:\s{12}.+(?:\r?\n|$))+)/m)
  const uploadedPaths = pathBlock
    ? pathBlock[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : []
  if (
    uploadedPaths.length !== safePaths.length ||
    uploadedPaths.some((path, index) => path !== safePaths[index])
  ) {
    throw new Error(
      `Backup upload must contain exactly the encrypted archive and checksum; found: ${uploadedPaths.join(', ') || 'none'}.`,
    )
  }
  if (/\.sql\b|\.tar(?:\.gz)?\b|ustsacmland-db-backup/.test(uploadBlock)) {
    throw new Error('Backup upload must never include plaintext SQL or archive paths.')
  }
  requireMatch(
    uploadBlock,
    /if-no-files-found:\s*error/,
    'Missing backup artifacts must fail the run.',
  )
  requireMatch(
    uploadBlock,
    /retention-days:\s*14/,
    'Encrypted backups must retain 14 daily copies.',
  )
  requireMatch(
    uploadBlock,
    /compression-level:\s*0/,
    'Already encrypted backup artifacts must not be recompressed.',
  )

  return { dumpCount, retentionDays: 14 }
}

async function main() {
  const workflow = await readFile(workflowUrl, 'utf8')
  const report = verifyDatabaseBackupWorkflow(workflow)
  console.log(
    `Verified encrypted database backup workflow: ${report.dumpCount} logical dumps, ${report.retentionDays}-day retention.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
