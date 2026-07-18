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

export function buildBackupRestoreManifest({
  dataSql,
  authDataSql,
  migrationsDataSql,
  metadataSource,
}) {
  const metadata = parseMetadata(metadataSource)
  const counts = mergeCounts(dataSql, authDataSql, migrationsDataSql)
  const rowCounts = {}

  for (const [key, table] of Object.entries(requiredTables)) {
    if (!counts.has(table)) throw new Error(`Backup dump is missing COPY data for ${table}.`)
    rowCounts[key] = counts.get(table)
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

  return {
    schemaVersion: 1,
    createdAt: new Date(createdAt).toISOString(),
    repository: requiredMetadata(metadata, 'repository'),
    commit,
    runId,
    recoveryNotBefore: new Date(recoveryNotBefore).toISOString(),
    supabaseCli: requiredMetadata(metadata, 'supabase_cli'),
    rowCounts,
  }
}

async function main() {
  const [dataPath, authDataPath, migrationsDataPath, metadataPath, outputPath] =
    process.argv.slice(2)
  if (!outputPath) {
    throw new Error(
      'Usage: node scripts/build-backup-restore-manifest.mjs <data.sql> <auth-data.sql> <migrations-data.sql> <metadata.txt> <output.json>',
    )
  }

  const manifest = buildBackupRestoreManifest({
    dataSql: await readFile(resolve(dataPath), 'utf8'),
    authDataSql: await readFile(resolve(authDataPath), 'utf8'),
    migrationsDataSql: await readFile(resolve(migrationsDataPath), 'utf8'),
    metadataSource: await readFile(resolve(metadataPath), 'utf8'),
  })
  await writeFile(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  })
  console.log('Created encrypted-backup restore manifest with seven aggregate row counts.')
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
