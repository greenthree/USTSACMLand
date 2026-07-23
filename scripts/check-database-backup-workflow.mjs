import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/database-backup.yml', import.meta.url)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

function requireIncludes(source, fragments, message) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${message}: ${fragment}`)
  }
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
    /if:\s+github\.repository == 'greenthree\/USTSACMLand' && github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/,
    'Backup workflow must run only for the canonical repository default branch.',
  )
  requireMatch(
    workflow,
    /environment:\s*\n\s+name: production-operations/,
    'Backup workflow must use the protected production-operations environment.',
  )
  requireMatch(
    workflow,
    /actions\/checkout@[\w]+[\s\S]*?with:\s*\n\s+ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
    'Backup workflow must check out the trusted default branch before using production secrets.',
  )

  const stepsStart = workflow.indexOf('    steps:')
  const jobConfiguration = stepsStart >= 0 ? workflow.slice(0, stepsStart) : workflow
  if (/\$\{\{\s*secrets\./.test(jobConfiguration)) {
    throw new Error('Backup secrets must be scoped only to the shell steps that consume them.')
  }

  for (const [pattern, message] of [
    [
      /SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/,
      'Supabase access must come from the SUPABASE_ACCESS_TOKEN Actions Secret.',
    ],
    [
      /SUPABASE_PROJECT_REF:\s*\$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}/,
      'The backup must target the configured Supabase project reference.',
    ],
    [
      /BACKUP_ENCRYPTION_PASSPHRASE:\s*\$\{\{ secrets\.BACKUP_ENCRYPTION_PASSPHRASE \}\}/,
      'Backup encryption passphrase must come from an Actions Secret.',
    ],
    [
      /BACKUP_RECOVERY_NOT_BEFORE:\s*\$\{\{ vars\.BACKUP_RECOVERY_NOT_BEFORE \|\| '1970-01-01T00:00:00\.000Z' \}\}/,
      'Backup workflow must read the external account-deletion recovery floor.',
    ],
    [
      /MAX_BACKUP_ARTIFACT_BYTES:\s*\$\{\{ vars\.MAX_BACKUP_ARTIFACT_BYTES \}\}/,
      'Backup artifact size limit must come from a required repository variable.',
    ],
    [
      /MAX_STORAGE_OBJECTS:\s*\$\{\{ vars\.MAX_STORAGE_OBJECTS \}\}/,
      'Storage object limit must come from a required repository variable.',
    ],
  ]) {
    requireMatch(workflow, pattern, message)
  }
  if (/SUPABASE_SERVICE_ROLE_KEY|STORAGE_S3_|AWS_(?:ACCESS|SECRET)/.test(workflow)) {
    throw new Error('Backup workflow must not introduce a long-lived Storage credential.')
  }
  requireMatch(
    workflow,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020[\s\S]*node-version-file:\s*\.nvmrc/,
    'Backup workflow must use the reviewed Node.js setup and repository runtime version.',
  )
  requireMatch(
    workflow,
    /\$\{#BACKUP_ENCRYPTION_PASSPHRASE\}\s*<\s*32/,
    'Backup workflow must reject encryption passphrases shorter than 32 characters.',
  )
  requireMatch(
    workflow,
    /set \+x\s+umask 077/,
    'Backup plaintext and diagnostic files must be owner-readable only.',
  )
  requireMatch(
    workflow,
    /MAX_BACKUP_ARTIFACT_BYTES" =~ \^\[1-9\]\[0-9\]\*\$/,
    'Backup workflow must reject a missing or invalid artifact size limit.',
  )
  requireMatch(
    workflow,
    /MAX_STORAGE_OBJECTS" =~ \^\[0-9\]\+\$/,
    'Backup workflow must reject a missing or invalid Storage object limit.',
  )
  requireMatch(
    workflow,
    /if \[\[ "\$SUPABASE_PROJECT_REF" != 'qzggoqdmsvktrtnjislw' \]\]; then/,
    'Backup workflow must reject every project reference except the canonical production project.',
  )
  requireMatch(
    workflow,
    /recovery_not_before=\$BACKUP_RECOVERY_NOT_BEFORE/,
    'Backup metadata must capture the external account-deletion recovery floor.',
  )

  const dumpCount = workflow.match(/npx --yes supabase@2\.109\.1 db dump/g)?.length ?? 0
  if (dumpCount !== 7) {
    throw new Error(
      `Backup workflow must contain seven pinned Supabase CLI dumps; found ${dumpCount}.`,
    )
  }
  requireMatch(
    workflow,
    /npx --yes supabase@2\.109\.1 link --project-ref "\$SUPABASE_PROJECT_REF"/,
    'Backup workflow must link the pinned CLI to the intended project.',
  )
  const linkedDumpCount = workflow.match(/db dump \\\r?\n\s+--linked/g)?.length ?? 0
  if (linkedDumpCount !== 7) {
    throw new Error(
      `All seven dumps must use short-lived linked credentials; found ${linkedDumpCount}.`,
    )
  }
  if (/--db-url|SUPABASE_DB_URL/.test(workflow)) {
    throw new Error(
      'Backup workflow must not store or use a long-lived database connection string.',
    )
  }
  for (const requiredFragment of [
    '--role-only',
    '--file "$backup_dir/schema.sql"',
    '--file "$auth_schema_dump"',
    'node scripts/extract-auth-user-triggers.mjs',
    '"$backup_dir/auth-hooks.sql"',
    '--file "$backup_dir/data.sql"',
    '--file "$storage_metadata_dump"',
    '-- Compatibility placeholder: auth data is included in data.sql.',
    '--schema auth',
    '--file "$backup_dir/migrations-schema.sql"',
    '--file "$backup_dir/migrations-data.sql"',
    '--schema supabase_migrations',
    '--schema public,private,auth',
    '--schema storage',
  ]) {
    if (!workflow.includes(requiredFragment)) {
      throw new Error(`Backup workflow is missing required dump coverage: ${requiredFragment}`)
    }
  }
  requireMatch(
    workflow,
    /--file "\$backup_dir\/data\.sql" \\\r?\n\s+--use-copy \\\r?\n\s+--data-only \\\r?\n\s+--schema public,private,auth(?:\r?\n|$)/,
    'Application and Auth data must be exported by one pg_dump snapshot.',
  )
  requireMatch(
    workflow,
    /printf '%s\\n' \\\r?\n\s+'-- Compatibility placeholder: auth data is included in data\.sql\.' \\\r?\n\s+> "\$backup_dir\/auth-data\.sql"/,
    'The legacy Auth data filename must be a non-secret compatibility placeholder.',
  )
  if (/--file "\$backup_dir\/auth-data\.sql"[\s\S]*--data-only/.test(workflow)) {
    throw new Error('Auth data must not be exported in a second inconsistent database snapshot.')
  }
  requireMatch(
    workflow,
    /--file "\$auth_schema_dump" \\\r?\n\s+--schema auth[\s\S]*extract-auth-user-triggers\.mjs[\s\S]*"\$backup_dir\/auth-hooks\.sql"[\s\S]*rm -f "\$auth_schema_dump"/,
    'The backup must extract the allow-listed Auth user triggers and remove the full Auth schema dump.',
  )
  requireMatch(
    workflow,
    /--file "\$storage_metadata_dump" \\\r?\n\s+--use-copy \\\r?\n\s+--data-only \\\r?\n\s+--schema storage/,
    'Storage object metadata must be exported through the same short-lived linked database session.',
  )

  const storageCopyCount = workflow.match(/npx --yes supabase@2\.109\.1 storage cp/g)?.length ?? 0
  if (storageCopyCount !== 1) {
    throw new Error(
      `Backup workflow must contain one pinned private Storage download; found ${storageCopyCount}.`,
    )
  }
  requireMatch(
    workflow,
    /grep -Eq '\^COPY private\\\.webchat_image_attachments \\\(' "\$backup_dir\/data\.sql"[\s\S]*node scripts\/webchat-storage-backup\.mjs plan \\\r?\n\s+"\$backup_dir\/data\.sql" \\\r?\n\s+"\$storage_metadata_dump" \\\r?\n\s+"\$MAX_STORAGE_OBJECTS" \\\r?\n\s+"\$MAX_BACKUP_ARTIFACT_BYTES" \\\r?\n\s+> "\$storage_snapshot_plan" 2> "\$storage_cli_log"[\s\S]*storage_object_count="\$\(jq -r '\.objectCount' "\$storage_snapshot_plan"\)"/,
    'Backup workflow must create a bounded database-and-Storage-metadata-referenced Storage download plan before downloading.',
  )
  requireMatch(
    workflow,
    /elif ! node scripts\/webchat-storage-backup\.mjs uninstalled \\\r?\n\s+"\$backup_dir\/storage\/webchat-images" \\\r?\n\s+"\$backup_dir\/metadata\.txt"/,
    'Backup workflow must emit an explicit empty snapshot when the image feature is not installed.',
  )
  requireMatch(
    workflow,
    /if \(\( storage_object_count > 0 \)\); then[\s\S]*while IFS= read -r object_path[\s\S]*storage cp[\s\S]*\.references\[\]\.path/,
    'Backup workflow must skip Storage downloads for empty snapshots and copy only planned object paths.',
  )
  requireMatch(
    workflow,
    /storage cp \\\r?\n\s+--linked \\\r?\n\s+--jobs 4 \\\r?\n\s+"ss:\/\/\/webchat-images\/\$object_path" \\\r?\n\s+"\$destination" \\\r?\n\s+>> "\$storage_cli_log" 2>&1/,
    'Private Storage must download only database-referenced objects with the pinned linked CLI and path-bearing output redirected.',
  )
  requireMatch(
    workflow,
    /node scripts\/webchat-storage-backup\.mjs \\\r?\n\s+"\$backup_dir\/data\.sql" \\\r?\n\s+"\$storage_metadata_dump" \\\r?\n\s+"\$storage_download_parent" \\\r?\n\s+"\$backup_dir\/storage\/webchat-images" \\\r?\n\s+"\$backup_dir\/metadata\.txt" \\\r?\n\s+"\$MAX_STORAGE_OBJECTS" \\\r?\n\s+"\$MAX_BACKUP_ARTIFACT_BYTES" \\\r?\n\s+> "\$storage_cli_log" 2>&1/,
    'Backup workflow must stage the exact database-referenced WebChat image object set with matching Storage metadata.',
  )
  requireMatch(
    workflow,
    /node scripts\/verify-webchat-storage-backup\.mjs \\\r?\n\s+archive "\$backup_dir\/storage\/webchat-images" \\\r?\n\s+> "\$storage_cli_log" 2>&1/,
    'Backup workflow must verify the staged private Storage directory before encryption.',
  )
  requireMatch(
    workflow,
    /node scripts\/build-backup-restore-manifest\.mjs[\s\S]*"\$backup_dir\/data\.sql"[\s\S]*"\$backup_dir\/auth-data\.sql"[\s\S]*"\$backup_dir\/migrations-data\.sql"[\s\S]*"\$backup_dir\/metadata\.txt"[\s\S]*"\$backup_dir\/storage\/webchat-images\/summary\.json"[\s\S]*"\$backup_dir\/restore-manifest\.json"/,
    'Backup workflow must build a versioned restore manifest including Storage aggregates.',
  )
  requireMatch(
    workflow,
    /checksum_manifest="\$RUNNER_TEMP\/ustsacmland-backup-sha256sums"[\s\S]*find \. -type f ! -name SHA256SUMS -print0 \\\r?\n\s+\| sort -z \\\r?\n\s+\| xargs -0 sha256sum \\\r?\n\s+> "\$checksum_manifest"[\s\S]*mv "\$checksum_manifest" "\$backup_dir\/SHA256SUMS"/,
    'Every dynamic backup file must be covered by the internal checksum file.',
  )

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
  for (const fragment of [
    'tar -xOzf "$verification_archive" \\',
    '\'./storage/webchat-images/manifest.ndjson\' > "$verification_manifest"',
    '\'./storage/webchat-images/summary.json\' > "$verification_summary"',
  ]) {
    if (!workflow.includes(fragment)) {
      throw new Error(`Encrypted backup self-verification is missing: ${fragment}`)
    }
  }
  requireMatch(
    workflow,
    /node scripts\/verify-webchat-storage-backup\.mjs listing[\s\S]*> "\$storage_cli_log" 2>&1/,
    'Encrypted backup archive allowlist verification must redirect path-bearing errors.',
  )
  requireMatch(
    workflow,
    /node scripts\/verify-webchat-storage-backup\.mjs \\\r?\n\s+archive "\$verification_dir\/storage\/webchat-images" \\\r?\n\s+> "\$storage_cli_log" 2>&1/,
    'Encrypted backup extracted Storage verification must redirect path-bearing errors.',
  )
  const listingVerification = workflow.indexOf(
    'node scripts/verify-webchat-storage-backup.mjs listing',
  )
  const archiveExtraction = workflow.indexOf('tar --extract --gzip --file "$verification_archive"')
  if (listingVerification < 0 || archiveExtraction < 0 || listingVerification > archiveExtraction) {
    throw new Error('The dynamic archive allowlist must be verified before archive extraction.')
  }
  requireMatch(
    workflow,
    /tar -tvzf "\$verification_archive"[\s\S]*awk '\$1 !~ \/\^\[-d\]\//,
    'Backup self-verification must reject symlinks and unsupported archive entry types.',
  )
  requireIncludes(
    workflow,
    [
      'tar -C "$backup_dir" -czf "$archive" . 2> "$storage_cli_log"',
      'tar -tzf "$verification_archive" 2> "$storage_cli_log" > "$archive_listing"',
      'tar --extract --gzip --file "$verification_archive" --directory "$verification_dir"',
    ],
    'Backup tar operations must redirect path-bearing errors',
  )
  requireMatch(
    workflow,
    /sha256sum -c SHA256SUMS > "\$verification_checksum_log" 2>&1/,
    'Decrypted checksum verification must redirect path-bearing output away from public logs.',
  )
  requireMatch(
    workflow,
    /encrypted_size="\$\(stat -c '%s' "\$encrypted"\)"[\s\S]*encrypted_size > MAX_BACKUP_ARTIFACT_BYTES/,
    'Backup workflow must fail before upload when the encrypted artifact exceeds its configured cap.',
  )
  const cleanupStart = workflow.indexOf('cleanup_plaintext()')
  const cleanupEnd = workflow.indexOf('trap cleanup_plaintext EXIT', cleanupStart)
  const cleanupBlock =
    cleanupStart >= 0 && cleanupEnd > cleanupStart ? workflow.slice(cleanupStart, cleanupEnd) : ''
  if (
    !/rm -rf "\$backup_dir" "\$verification_dir" "\$storage_download_parent"/.test(cleanupBlock) ||
    !cleanupBlock.includes('"$verification_checksum_log"') ||
    !cleanupBlock.includes('"$storage_cli_log"') ||
    !cleanupBlock.includes('"$storage_snapshot_plan"') ||
    !cleanupBlock.includes('"$checksum_manifest"') ||
    !cleanupBlock.includes('"$storage_metadata_dump"')
  ) {
    throw new Error(
      'Plaintext cleanup must include downloaded Storage, verification output, and path-bearing logs.',
    )
  }
  requireIncludes(
    workflow,
    [
      'test ! -e "$backup_dir"',
      'test ! -e "$archive"',
      'test ! -e "$verification_archive"',
      'test ! -e "$auth_schema_dump"',
      'test ! -e "$storage_metadata_dump"',
      'test ! -e "$storage_download_parent"',
      'test ! -e "$verification_dir"',
    ],
    'Plaintext database and Storage files must be removed and verified absent before upload',
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
  if (/\.sql\b|\.tar(?:\.gz)?\b|ustsacmland-db-backup|webchat-images/.test(uploadBlock)) {
    throw new Error('Backup upload must never include plaintext database or Storage paths.')
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

  return { dumpCount, storageCopyCount, retentionDays: 14 }
}

async function main() {
  const workflow = await readFile(workflowUrl, 'utf8')
  const report = verifyDatabaseBackupWorkflow(workflow)
  console.log(
    `Verified encrypted database backup workflow: ${report.dumpCount} logical dumps, ${report.storageCopyCount} private Storage snapshot, ${report.retentionDays}-day retention.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
