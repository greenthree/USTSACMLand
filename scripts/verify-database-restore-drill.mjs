import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rowCountKeys = [
  'profiles',
  'platformAccounts',
  'platformStats',
  'statSnapshots',
  'syncRuns',
  'authUsers',
  'migrations',
]

const orphanKeys = [
  'profilesWithoutAuth',
  'accountsWithoutProfile',
  'statsWithoutProfile',
  'statsWithoutAccount',
]

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

function requiredString(value, label, pattern = /\S/) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

export function verifyDatabaseRestoreDrill(manifest, observation) {
  if (manifest?.schemaVersion !== 1) throw new Error('Restore manifest version is unsupported.')
  const runId = requiredString(observation?.sourceRunId, 'Observed source run ID', /^\d+$/)
  if (runId !== requiredString(manifest.runId, 'Manifest source run ID', /^\d+$/)) {
    throw new Error('Restore observation does not match the backup run ID.')
  }

  const sourceSha = requiredString(
    observation?.sourceSha,
    'Observed source commit',
    /^[0-9a-f]{40}$/,
  )
  if (sourceSha !== requiredString(manifest.commit, 'Manifest source commit', /^[0-9a-f]{40}$/)) {
    throw new Error('Restore observation does not match the backup commit.')
  }

  if (observation?.sourceRepository !== manifest.repository) {
    throw new Error('Restore observation does not match the backup repository.')
  }

  const rowCounts = {}
  for (const key of rowCountKeys) {
    const expected = integer(manifest?.rowCounts?.[key], `Manifest ${key} count`)
    const observed = integer(observation?.rowCounts?.[key], `Observed ${key} count`)
    if (observed !== expected) {
      throw new Error(`Restored ${key} row count differs from the encrypted manifest.`)
    }
    rowCounts[key] = observed
  }

  for (const key of orphanKeys) {
    if (integer(observation?.orphanCounts?.[key], `Observed ${key} count`) !== 0) {
      throw new Error(`Restored database contains ${key}.`)
    }
  }

  for (const [key, value] of Object.entries({
    canaryCreated: observation?.authSmoke?.canaryCreated,
    passwordLogin: observation?.authSmoke?.passwordLogin,
    ownProfileReadable: observation?.authSmoke?.ownProfileReadable,
    otherProfilesHidden: observation?.authSmoke?.otherProfilesHidden,
    canaryDeleted: observation?.authSmoke?.canaryDeleted,
  })) {
    if (value !== true) throw new Error(`Restore Auth smoke check failed: ${key}.`)
  }

  if (observation?.restSmoke?.anonymousPublicStatus !== 200) {
    throw new Error('Anonymous public-view smoke check did not return HTTP 200.')
  }
  if (![401, 403].includes(observation?.restSmoke?.anonymousPrivateStatus)) {
    throw new Error('Anonymous private-table smoke check did not fail closed.')
  }

  const durationSeconds = integer(observation?.durationSeconds, 'Restore duration')
  const completedAt = requiredString(observation?.completedAt, 'Restore completion time')
  if (!Number.isFinite(Date.parse(completedAt))) {
    throw new Error('Restore completion time is not a valid timestamp.')
  }

  return {
    ok: true,
    source: {
      runId,
      commit: sourceSha,
      createdAt: requiredString(manifest.createdAt, 'Manifest creation time'),
      supabaseCli: requiredString(manifest.supabaseCli, 'Manifest Supabase CLI version'),
    },
    completedAt: new Date(completedAt).toISOString(),
    durationSeconds,
    restoredRowCounts: rowCounts,
    integrity: {
      orphanCounts: Object.fromEntries(orphanKeys.map((key) => [key, 0])),
      authPasswordLogin: true,
      ownProfileRls: true,
      otherProfilesHiddenByRls: true,
      anonymousPublicView: true,
      anonymousPrivateTableDenied: true,
      canaryCleanedUp: true,
    },
  }
}

async function main() {
  const [manifestPath, observationPath, outputPath] = process.argv.slice(2)
  if (!outputPath) {
    throw new Error(
      'Usage: node scripts/verify-database-restore-drill.mjs <restore-manifest.json> <observation.json> <report.json>',
    )
  }

  const report = verifyDatabaseRestoreDrill(
    JSON.parse(await readFile(resolve(manifestPath), 'utf8')),
    JSON.parse(await readFile(resolve(observationPath), 'utf8')),
  )
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(
    `Verified isolated restore drill for backup run ${report.source.runId}: seven row counts and Auth/RLS smoke checks passed.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
