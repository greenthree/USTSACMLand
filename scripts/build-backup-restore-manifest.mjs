import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredTables = {
  profiles: 'public.profiles',
  platformAccounts: 'public.platform_accounts',
  platformStats: 'public.platform_stats',
  statSnapshots: 'public.stat_snapshots',
  syncRuns: 'public.sync_runs',
  authUsers: 'auth.users',
  migrations: 'supabase_migrations.schema_migrations',
}

const webChatImageAttachmentsTable = 'private.webchat_image_attachments'
const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function unquoteIdentifier(quoted, plain) {
  return quoted === undefined ? plain : quoted.replaceAll('""', '"')
}

export function countCopyRows(source) {
  const counts = new Map()
  let currentTable = null
  let currentRows = 0

  for (const line of source.split(/\r?\n/)) {
    if (currentTable) {
      if (line === '\\.') {
        if (counts.has(currentTable)) {
          throw new Error(`Backup dump repeats COPY data for ${currentTable}.`)
        }
        counts.set(currentTable, currentRows)
        currentTable = null
        currentRows = 0
      } else {
        currentRows += 1
      }
      continue
    }

    const match = line.match(
      /^COPY\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\.(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s+\([^)]*\)\s+FROM stdin;$/,
    )
    if (!match) continue

    const schema = unquoteIdentifier(match[1], match[2])
    const table = unquoteIdentifier(match[3], match[4])
    currentTable = `${schema}.${table}`
  }

  if (currentTable)
    throw new Error(`Backup dump has an unterminated COPY block for ${currentTable}.`)
  return counts
}

function parseMetadata(source) {
  const metadata = new Map()
  for (const line of source.split(/\r?\n/)) {
    if (!line) continue
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error('Backup metadata contains an invalid line.')
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    if (metadata.has(key)) throw new Error(`Backup metadata repeats ${key}.`)
    metadata.set(key, value)
  }
  return metadata
}

function requiredMetadata(metadata, key) {
  const value = metadata.get(key)
  if (!value) throw new Error(`Backup metadata is missing ${key}.`)
  return value
}

function mergeCounts(...sources) {
  const merged = new Map()
  for (const source of sources) {
    for (const [table, count] of countCopyRows(source)) {
      if (merged.has(table)) throw new Error(`Backup dumps repeat table ${table}.`)
      merged.set(table, count)
    }
  }
  return merged
}

function parseStorageSummary(storageSummary) {
  const expectedKeys =
    storageSummary?.schemaVersion === 1
      ? ['schemaVersion', 'bucket', 'snapshotAt', 'objectCount', 'totalBytes', 'manifestSha256']
      : [
          'schemaVersion',
          'featureState',
          'bucket',
          'snapshotAt',
          'objectCount',
          'totalBytes',
          'manifestSha256',
        ]
  const actualKeys = Object.keys(storageSummary ?? {}).sort()
  expectedKeys.sort()
  const featureState =
    storageSummary?.schemaVersion === 1 ? 'installed' : storageSummary?.featureState
  if (
    !storageSummary ||
    ![1, 2].includes(storageSummary.schemaVersion) ||
    (storageSummary.schemaVersion === 2 && !['installed', 'uninstalled'].includes(featureState)) ||
    storageSummary.bucket !== 'webchat-images' ||
    typeof storageSummary.snapshotAt !== 'string' ||
    !Number.isFinite(Date.parse(storageSummary.snapshotAt)) ||
    !Number.isSafeInteger(storageSummary.objectCount) ||
    storageSummary.objectCount < 0 ||
    !Number.isSafeInteger(storageSummary.totalBytes) ||
    storageSummary.totalBytes < 0 ||
    typeof storageSummary.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(storageSummary.manifestSha256) ||
    (featureState === 'uninstalled' &&
      (storageSummary.objectCount !== 0 ||
        storageSummary.totalBytes !== 0 ||
        storageSummary.manifestSha256 !== emptySha256)) ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error('WebChat Storage summary is invalid.')
  }
  return { ...storageSummary, featureState }
}

export function buildBackupRestoreManifest({
  dataSql,
  authDataSql,
  migrationsDataSql,
  metadataSource,
  storageSummary,
}) {
  const metadata = parseMetadata(metadataSource)
  const storage = parseStorageSummary(storageSummary)
  const counts = mergeCounts(dataSql, migrationsDataSql)
  const legacyAuthCounts = countCopyRows(authDataSql)
  for (const [table, count] of legacyAuthCounts) {
    if (counts.has(table)) throw new Error(`Backup dumps repeat table ${table}.`)
    counts.set(table, count)
  }
  const rowCounts = {}

  for (const [key, table] of Object.entries(requiredTables)) {
    if (!counts.has(table)) throw new Error(`Backup dump is missing COPY data for ${table}.`)
    rowCounts[key] = counts.get(table)
  }

  if (storage.featureState === 'installed') {
    if (!counts.has(webChatImageAttachmentsTable)) {
      throw new Error(`Backup dump is missing COPY data for ${webChatImageAttachmentsTable}.`)
    }
    rowCounts.webchatImageAttachments = counts.get(webChatImageAttachmentsTable)
  } else {
    if (counts.has(webChatImageAttachmentsTable)) {
      throw new Error(
        'Backup dump contains WebChat image attachments but Storage is marked uninstalled.',
      )
    }
    rowCounts.webchatImageAttachments = 0
  }

  const createdAt = requiredMetadata(metadata, 'created_at')
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error('Backup metadata created_at is not a valid timestamp.')
  }

  const recoveryNotBefore = requiredMetadata(metadata, 'recovery_not_before')
  if (!Number.isFinite(Date.parse(recoveryNotBefore))) {
    throw new Error('Backup metadata recovery_not_before is not a valid timestamp.')
  }

  const runId = requiredMetadata(metadata, 'run_id')
  if (!/^\d+$/.test(runId)) throw new Error('Backup metadata run_id is invalid.')

  const commit = requiredMetadata(metadata, 'commit')
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Backup metadata commit is invalid.')

  if (new Date(storage.snapshotAt).toISOString() !== new Date(createdAt).toISOString()) {
    throw new Error('WebChat Storage summary does not match the database snapshot time.')
  }

  return {
    schemaVersion: 2,
    createdAt: new Date(createdAt).toISOString(),
    repository: requiredMetadata(metadata, 'repository'),
    commit,
    runId,
    recoveryNotBefore: new Date(recoveryNotBefore).toISOString(),
    supabaseCli: requiredMetadata(metadata, 'supabase_cli'),
    rowCounts,
    storage: {
      featureState: storage.featureState,
      bucket: storage.bucket,
      objectCount: storage.objectCount,
      totalBytes: storage.totalBytes,
      manifestSha256: storage.manifestSha256,
    },
  }
}

async function main() {
  const [dataPath, authDataPath, migrationsDataPath, metadataPath, storageSummaryPath, outputPath] =
    process.argv.slice(2)
  if (!outputPath) {
    throw new Error(
      'Usage: node scripts/build-backup-restore-manifest.mjs <data.sql> <auth-data.sql> <migrations-data.sql> <metadata.txt> <storage-summary.json> <output.json>',
    )
  }

  const manifest = buildBackupRestoreManifest({
    dataSql: await readFile(resolve(dataPath), 'utf8'),
    authDataSql: await readFile(resolve(authDataPath), 'utf8'),
    migrationsDataSql: await readFile(resolve(migrationsDataPath), 'utf8'),
    metadataSource: await readFile(resolve(metadataPath), 'utf8'),
    storageSummary: JSON.parse(await readFile(resolve(storageSummaryPath), 'utf8')),
  })
  await writeFile(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  })
  console.log(
    'Created encrypted-backup restore manifest with eight aggregate row counts and private Storage totals.',
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
