import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/database-restore-drill.yml', import.meta.url)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

function requireIncludes(source, fragments, message) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${message}: ${fragment}`)
  }
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

  const stepsStart = workflow.indexOf('    steps:')
  const jobConfiguration = stepsStart >= 0 ? workflow.slice(0, stepsStart) : workflow
  if (/\$\{\{\s*secrets\./.test(jobConfiguration)) {
    throw new Error('Restore secrets must be scoped only to the shell step that consumes them.')
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

  requireIncludes(
    workflow,
    [
      '.name == "Encrypted database backup"',
      '.head_branch == "main"',
      '.head_repository.full_name == $repository',
      '.conclusion == "success"',
      '.path == ".github/workflows/database-backup.yml"',
      '.expired == false',
      'artifact_name="ustsacmland-database-backup-$BACKUP_RUN_ID-$run_attempt"',
    ],
    'Restore drill is missing trusted backup-source validation',
  )
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
    /sha256sum -c ustsacmland-database-backup\.enc\.sha256 > "\$verification_log" 2>&1/,
    'Restore drill must verify the encrypted artifact checksum without exposing paths.',
  )
  requireMatch(
    workflow,
    /- name: Decrypt and verify backup[\s\S]*set \+x\s+umask 077/,
    'Restore plaintext and verification logs must be owner-readable only.',
  )
  requireMatch(
    workflow,
    /tar -xOzf "\$archive" \\\r?\n\s+'\.\/storage\/webchat-images\/manifest\.ndjson' > "\$storage_manifest"/,
    'Restore drill must extract the Storage manifest from the decrypted archive.',
  )
  requireMatch(
    workflow,
    /tar -xOzf "\$archive" \\\r?\n\s+'\.\/storage\/webchat-images\/summary\.json' > "\$storage_summary"/,
    'Restore drill must extract the Storage aggregate summary from the decrypted archive.',
  )
  requireMatch(
    workflow,
    /node scripts\/verify-webchat-storage-backup\.mjs listing[\s\S]*"\$listing" "\$storage_manifest" "\$storage_summary"[\s\S]*> "\$verification_log" 2>&1/,
    'Restore drill must dynamically verify the archive member allowlist before extraction.',
  )
  requireMatch(
    workflow,
    /storage_manifest_present=false[\s\S]*storage_summary_present=false[\s\S]*grep -Fxq '\.\/storage\/webchat-images\/manifest\.ndjson'[\s\S]*grep -Fxq '\.\/storage\/webchat-images\/summary\.json'[\s\S]*grep -Eq '\^\\\.\/storage\/'[\s\S]*verify-webchat-storage-backup\.mjs listing \\\r?\n\s+"\$listing" > "\$verification_log" 2>&1/,
    'Restore drill must support only a strict Storage-free v1 archive allowlist.',
  )
  if (/diff -u <\(printf/.test(workflow)) {
    throw new Error(
      'Restore drill must not use a fixed archive member list for dynamic Storage objects.',
    )
  }
  requireMatch(
    workflow,
    /tar -tvzf "\$archive"[\s\S]*awk '\$1 !~ \/\^\[-d\]\//,
    'Restore drill must reject symlinks and unsupported archive entry types before extraction.',
  )
  if (/jq[^\n]*\|\s*head\b|jq[^\n]*\r?\n[^\n]*\|\s*head\b/.test(workflow)) {
    throw new Error('Restore drill must not combine jq with head under pipefail.')
  }
  requireMatch(
    workflow,
    /jq -r -s 'first\(\.\[\] \| \.path\) \/\/ empty' "\$storage_source\/manifest\.ndjson"/,
    'Restore drill must select its first Storage path inside jq without a SIGPIPE-prone head.',
  )
  requireIncludes(
    workflow,
    [
      'tar -tzf "$archive" 2> "$verification_log" | sort > "$listing"',
      'tar --extract --gzip --file "$archive" --directory "$restore_dir"',
      '2> "$verification_log"',
    ],
    'Restore tar operations must redirect path-bearing errors',
  )
  requireMatch(
    workflow,
    /sha256sum -c SHA256SUMS > "\$verification_log" 2>&1/,
    'Restore drill must verify every decrypted file checksum without exposing object paths.',
  )
  requireMatch(
    workflow,
    /node scripts\/verify-webchat-storage-backup\.mjs \\\r?\n\s+archive "\$restore_dir\/storage\/webchat-images" \\\r?\n\s+> "\$verification_log" 2>&1/,
    'Restore drill must verify the extracted Storage directory before local restore.',
  )
  requireMatch(
    workflow,
    /\.schemaVersion == 1 and \.storage == null[\s\S]*\.schemaVersion == 2[\s\S]*\.storage\.bucket == "webchat-images"[\s\S]*\.storage\.featureState == "installed"[\s\S]*\.storage\.featureState == "uninstalled"/,
    'Restore drill must accept strict legacy v1 and feature-state-aware v2 manifests only.',
  )
  requireMatch(
    workflow,
    /verify-backup-recovery-floor\.mjs "\$restore_dir\/metadata\.txt"[\s\S]*> "\$verification_log" 2>&1/,
    'Restore drill must reject backups older than the current recovery floor.',
  )

  requireMatch(
    workflow,
    /mv supabase\/migrations "\$RUNNER_TEMP\/repository-migrations"/,
    'Restore drill must remove repository migrations from the isolated target baseline.',
  )
  requireMatch(
    workflow,
    /npx --yes supabase@2\.109\.1 start \\\r?\n\s+--exclude analytics,edge-runtime,functions,imgproxy,inbucket,realtime,studio,vector/,
    'Restore drill must pin the local Supabase version while keeping Storage enabled.',
  )
  if (/--exclude[^\n]*\bstorage\b/.test(workflow)) {
    throw new Error('Restore drill must keep the local Storage service enabled.')
  }
  requireMatch(
    workflow,
    /db_container='supabase_db_usts-acm-land'[\s\S]*docker inspect "\$db_container"[\s\S]*docker cp "\$restore_dir\/\." "\$db_container:\$container_restore\/"[\s\S]*docker exec "\$db_container" psql[\s\S]*--username supabase_admin[\s\S]*--single-transaction[\s\S]*--file "\$container_restore\/roles\.sql"[\s\S]*--file "\$container_restore\/schema\.sql"[\s\S]*--file "\$container_restore\/auth-hooks\.sql"[\s\S]*--file "\$container_restore\/data\.sql"[\s\S]*--file "\$container_restore\/auth-data\.sql"[\s\S]*--file "\$container_restore\/migrations-schema\.sql"[\s\S]*--file "\$container_restore\/migrations-data\.sql"/,
    'Restore drill must atomically restore roles, schema, Auth hooks, business data, Auth data, and migration history.',
  )
  requireMatch(
    workflow,
    /--command 'set session_replication_role = origin' \\\r?\n\s+> "\$restore_psql_log" 2>&1; then[\s\S]*database output was kept out of the public log/,
    'Restore SQL output must remain in a temporary private log and never be echoed to Actions.',
  )
  if (
    /(?:cat|head|tail|less|more|tee|sed\s+-n)[^\n]*\$restore_psql_log|\$restore_psql_log[^\n]*\|/.test(
      workflow,
    )
  ) {
    throw new Error('Restore SQL diagnostics must never be replayed into the Actions log.')
  }
  requireMatch(
    workflow,
    /insert into storage\.buckets[\s\S]*'webchat-images'[\s\S]*false[\s\S]*4194304[\s\S]*image\/webp/,
    'Restore drill must create the local private WebChat bucket with its size and MIME limits.',
  )
  requireMatch(
    workflow,
    /while IFS=\$'\\t' read -r object_path content_type cache_control[\s\S]*storage\/v1\/object\/webchat-images\/\$object_path[\s\S]*SERVICE_ROLE_KEY[\s\S]*Content-Type: \$content_type[\s\S]*Cache-Control: \$cache_control[\s\S]*x-upsert: false[\s\S]*\[\.path, \.contentType, \.cacheControl\] \| @tsv/,
    'Restore drill must upload each immutable WebChat object with its verified manifest metadata.',
  )
  requireMatch(
    workflow,
    /if \(\( storage_object_count == 0 \)\); then[\s\S]*restore-boundary-canary\.webp[\s\S]*probe_created=true/,
    'Restore drill must use a disposable probe to verify privacy for empty buckets.',
  )
  requireMatch(
    workflow,
    /select public::text from storage\.buckets where id = 'webchat-images'[\s\S]*bucket_private.*!= 'f'/,
    'Restore drill must verify the restored Storage bucket remains private.',
  )
  requireMatch(
    workflow,
    /anonymous_storage_curl_exit=0[\s\S]*anonymous_storage_status=[\s\S]*?\|\| anonymous_storage_curl_exit=\$\?[\s\S]*anonymous_storage_bearer_curl_exit=0[\s\S]*Authorization: Bearer \$ANON_KEY[\s\S]*?\|\| anonymous_storage_bearer_curl_exit=\$\?[\s\S]*anonymous_storage_curl_exit != 0 \|\| anonymous_storage_bearer_curl_exit != 0/,
    'Restore drill must fail visibly when either anonymous Storage probe has a transport error.',
  )
  requireMatch(
    workflow,
    /anonymous_storage_status" =~ \^\(400\|401\|403\|404\)\$[\s\S]*anonymous_storage_bearer_status" =~ \^\(400\|401\|403\|404\)\$/,
    'Restore drill must accept only the explicit expected anonymous Storage 4xx statuses.',
  )
  requireIncludes(
    workflow,
    [
      '--request DELETE',
      '"$API_URL/storage/v1/object/webchat-images"',
      '--data "{\\"prefixes\\":[\\"$probe_path\\"]}"',
    ],
    'Restore drill must delete the disposable Storage probe through the supported batch API',
  )
  requireMatch(
    workflow,
    /storage cp \\\r?\n\s+--local \\\r?\n\s+--recursive \\\r?\n\s+--jobs 4 \\\r?\n\s+ss:\/\/\/webchat-images\//,
    'Restore drill must download restored Storage through the pinned local CLI.',
  )
  requireMatch(
    workflow,
    /json_build_object\([\s\S]*'path', attachment\.object_key[\s\S]*'sha256', attachment\.sha256[\s\S]*'bytes', attachment\.object_bytes[\s\S]*'contentType', object\.metadata ->> 'mimetype'[\s\S]*'cacheControl', object\.metadata ->> 'cacheControl'[\s\S]*join storage\.objects as object[\s\S]*object\.bucket_id = attachment\.bucket_id[\s\S]*object\.name = attachment\.object_key/,
    'Restore drill must query canonical database references and actual Storage object metadata for exact comparison.',
  )
  requireMatch(
    workflow,
    /node scripts\/verify-webchat-storage-restore\.mjs[\s\S]*"\$storage_refs"[\s\S]*"\$storage_boundary"[\s\S]*"\$storage_observation"[\s\S]*> "\$storage_cli_log" 2>&1/,
    'Restore drill must compare restored object bytes, hashes, privacy, and database references.',
  )

  requireMatch(
    workflow,
    /storage_feature_state" == installed[\s\S]*select pg_catalog\.count\(\*\) from private\.webchat_image_attachments[\s\S]*\. \+ \{webchatImageAttachments: \$count\}[\s\S]*storage_feature_state" == uninstalled[\s\S]*\. \+ \{webchatImageAttachments: 0\}/,
    'Restore drill must include WebChat image attachment row counts.',
  )
  requireMatch(
    workflow,
    /storage_feature_state" == uninstalled[\s\S]*\{featureInstalled: false\}[\s\S]*verify-webchat-storage-restore\.mjs[\s\S]*storage_feature_state" == legacy-unavailable[\s\S]*jq -n 'null' > "\$storage_observation"/,
    'Restore drill must safely distinguish uninstalled v2 Storage from legacy v1 backups.',
  )
  requireIncludes(
    workflow,
    ['authUsersWithoutProfile', 'webchatImagesWithoutProfile', 'webchatImagesWithoutConversation'],
    'Restore drill must check WebChat image relational orphans',
  )
  requireMatch(
    workflow,
    /'authUsersWithoutProfile',[\s\S]*from auth\.users u[\s\S]*left join public\.profiles p on p\.id = u\.id where p\.id is null/,
    'Restore drill must reject Auth users that have no application Profile.',
  )
  requireMatch(
    workflow,
    /'webchatImagesWithoutConversation',[\s\S]*from private\.webchat_image_attachments a[\s\S]*left join private\.webchat_conversations c on c\.id = a\.conversation_id[\s\S]*where c\.id is null[\s\S]*a\.status in \('reserved', 'validating', 'ready', 'attached', 'failed'\)/,
    'Restore drill must treat only active image rows as conversation orphans and allow deletion tombstones.',
  )
  requireMatch(
    workflow,
    /--slurpfile storageObservation "\$storage_observation"[\s\S]*storage: \$storageObservation\[0\]/,
    'Restore drill observation must include only the sanitized aggregate Storage result.',
  )
  requireIncludes(
    workflow,
    [
      'auth/v1/admin/users',
      'auth/v1/token?grant_type=password',
      'auth_users_0_require_fenced_deletion',
      'auth_users_a_prepare_account_deletion',
      'on_auth_user_created',
      'rest/v1/rpc/acquire_account_deletion_recovery_lease',
      'rest/v1/rpc/delete_auth_user_with_recovery_lease',
      'rest/v1/profiles?select=id&id=eq.$canary_id',
      'rest/v1/profiles?select=id&id=neq.$canary_id&limit=1',
      'rest/v1/public_members?select=id&limit=1',
      'anonymous_private_status',
      'anonymous_private_empty',
      'verify-database-restore-drill.mjs',
    ],
    'Restore drill is missing Auth/RLS or aggregate verification',
  )
  for (const phase of [
    'Restore transaction completed.',
    'Restored WebChat image objects uploaded to the isolated private bucket.',
    'Private WebChat Storage bucket and anonymous access boundaries verified.',
    'Restored WebChat Storage bytes, hashes, and database references verified.',
    'Aggregate row-count and orphan queries completed.',
    'Auth user application triggers restored.',
    'Isolated Auth canary created.',
    'Isolated Auth password login completed.',
    'Authenticated own-Profile RLS checks completed.',
    'Anonymous REST boundary checks completed.',
    'Isolated Auth canary cleanup completed.',
  ]) {
    if (!workflow.includes(phase))
      throw new Error(`Restore drill is missing a sanitized diagnostic phase: ${phase}`)
  }
  requireMatch(
    workflow,
    /anonymous_private_status" == 200[\s\S]*type == "array" and length == 0[\s\S]*anonymous_private_empty=true[\s\S]*anonymous_private_status" != 401[\s\S]*anonymous_private_status" != 403/,
    'Restore drill must accept only denied or strictly empty RLS-filtered anonymous private responses.',
  )
  requireMatch(
    workflow,
    /canary_id" =~ \^\[0-9a-f-\]\{36\}\$[\s\S]*delete_auth_user_with_recovery_lease[\s\S]*where coalesce\(u\.id, p\.id\) = '\$canary_id'::uuid/,
    'Restore drill must validate the canary UUID before checking fenced-deletion cleanup.',
  )
  if (/curl[^\n]*(?:greenthree\.github\.io|supabase\.co|127\.0\.0\.1:5432[12])/i.test(workflow)) {
    throw new Error('Restore smoke requests must use only the local API URL discovered at runtime.')
  }
  requireMatch(
    workflow,
    /trap 'docker exec "\$db_container" rm -rf "\$container_restore"[\s\S]*docker exec "\$db_container" rm -rf "\$container_restore"[\s\S]*trap - EXIT/,
    'Restore drill must remove decrypted files copied into the disposable database container.',
  )
  if (/\bpsql "\$DB_URL"|set (?:local )?role supabase_auth_admin/i.test(workflow)) {
    throw new Error(
      'Restore drill must use only the disposable container platform-admin socket, not role escalation from the local client.',
    )
  }

  requireMatch(
    workflow,
    /- name: Stop isolated local Supabase\s+if: always\(\)\s+run: npx --yes supabase@2\.109\.1 stop --no-backup/,
    'Restore drill must always destroy the isolated database without preserving state.',
  )
  requireMatch(
    workflow,
    /- name: Remove decrypted backup and temporary credentials\s+if: always\(\)/,
    'Restore drill must always remove plaintext, Storage downloads, and temporary credentials.',
  )
  requireMatch(
    workflow,
    /restored-storage-download[\s\S]*restored-storage-cli\.log[\s\S]*restored-database-psql\.log[\s\S]*test ! -e "\$RUNNER_TEMP\/restored-storage-download"/,
    'Restore drill must remove and verify all restored Storage plaintext and logs.',
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
  if (
    /\.sql\b|\.enc\b|\.tar(?:\.gz)?\b|restored-backup|canary-|storage-download/i.test(uploadBlock)
  ) {
    throw new Error(
      'Restore report upload must never include backup data or temporary credentials.',
    )
  }
  requireMatch(uploadBlock, /retention-days:\s*14/, 'Restore evidence must expire after 14 days.')

  return { manualOnly: true, aggregateCounts: 8, storageVerification: true, retentionDays: 14 }
}

async function main() {
  const workflow = await readFile(workflowUrl, 'utf8')
  const report = verifyDatabaseRestoreDrillWorkflow(workflow)
  console.log(
    `Verified isolated database restore drill: manual-only, ${report.aggregateCounts} aggregate counts, private Storage verification, ${report.retentionDays}-day sanitized evidence.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
