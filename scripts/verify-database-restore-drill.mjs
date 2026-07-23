import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const legacyRowCountKeys = [
  'profiles',
  'platformAccounts',
  'platformStats',
  'statSnapshots',
  'syncRuns',
  'authUsers',
  'migrations',
]

const storageRowCountKey = 'webchatImageAttachments'

const coreOrphanKeys = [
  'profilesWithoutAuth',
  'authUsersWithoutProfile',
  'accountsWithoutProfile',
  'statsWithoutProfile',
  'statsWithoutAccount',
]

const storageOrphanKeys = ['webchatImagesWithoutProfile', 'webchatImagesWithoutConversation']

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
  if (![1, 2].includes(manifest?.schemaVersion)) {
    throw new Error('Restore manifest version is unsupported.')
  }
  if (
    manifest.schemaVersion === 1 &&
    (manifest.storage != null ||
      Object.prototype.hasOwnProperty.call(manifest?.rowCounts ?? {}, storageRowCountKey))
  ) {
    throw new Error('Legacy restore manifest unexpectedly contains Storage data.')
  }
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

  const featureState =
    manifest.schemaVersion === 1 ? 'legacy-unavailable' : manifest?.storage?.featureState
  if (
    manifest.schemaVersion === 2 &&
    featureState !== 'installed' &&
    featureState !== 'uninstalled'
  ) {
    throw new Error('Manifest Storage feature state is invalid.')
  }
  const rowCountKeys =
    manifest.schemaVersion === 1 ? legacyRowCountKeys : [...legacyRowCountKeys, storageRowCountKey]
  const rowCounts = {}
  for (const key of rowCountKeys) {
    const expected = integer(manifest?.rowCounts?.[key], `Manifest ${key} count`)
    const observed = integer(observation?.rowCounts?.[key], `Observed ${key} count`)
    if (observed !== expected) {
      throw new Error(`Restored ${key} row count differs from the encrypted manifest.`)
    }
    rowCounts[key] = observed
  }

  const orphanKeys = [...coreOrphanKeys, ...(featureState === 'installed' ? storageOrphanKeys : [])]
  for (const key of orphanKeys) {
    if (integer(observation?.orphanCounts?.[key], `Observed ${key} count`) !== 0) {
      throw new Error(`Restored database contains ${key}.`)
    }
  }

  let restoredStorage = null
  if (manifest.schemaVersion === 2) {
    const manifestStorage = manifest.storage
    const observedStorage = observation?.storage
    if (
      manifestStorage?.bucket !== 'webchat-images' ||
      observedStorage?.bucket !== manifestStorage.bucket ||
      observedStorage?.featureState !== featureState
    ) {
      throw new Error('Restored Storage identity differs from the encrypted manifest.')
    }
    const storageObjectCount = integer(manifestStorage.objectCount, 'Manifest Storage object count')
    if (
      integer(observedStorage.objectCount, 'Observed Storage object count') !== storageObjectCount
    ) {
      throw new Error('Restored Storage object count differs from the encrypted manifest.')
    }
    const storageTotalBytes = integer(manifestStorage.totalBytes, 'Manifest Storage total bytes')
    if (integer(observedStorage.totalBytes, 'Observed Storage total bytes') !== storageTotalBytes) {
      throw new Error('Restored Storage byte total differs from the encrypted manifest.')
    }
    const storageManifestSha256 = requiredString(
      manifestStorage.manifestSha256,
      'Manifest Storage digest',
      /^[a-f0-9]{64}$/,
    )
    if (observedStorage.manifestSha256 !== storageManifestSha256) {
      throw new Error('Restored Storage digest differs from the encrypted manifest.')
    }
    if (featureState === 'installed') {
      for (const [key, value] of Object.entries({
        bucketPrivate: observedStorage.bucketPrivate,
        anonymousDenied: observedStorage.anonymousDenied,
        databaseReferencesMatched: observedStorage.databaseReferencesMatched,
        objectHashesVerified: observedStorage.objectHashesVerified,
      })) {
        if (value !== true) throw new Error(`Restore Storage smoke check failed: ${key}.`)
      }
    } else {
      if (
        integer(manifest.rowCounts[storageRowCountKey], 'Manifest image attachment count') !== 0 ||
        storageObjectCount !== 0 ||
        storageTotalBytes !== 0 ||
        storageManifestSha256 !==
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' ||
        observedStorage.featureAbsent !== true ||
        observedStorage.databaseReferencesMatched !== true ||
        observedStorage.objectHashesVerified !== true
      ) {
        throw new Error('Uninstalled Storage restore evidence is invalid.')
      }
    }
    restoredStorage = {
      featureState,
      bucket: 'webchat-images',
      objectCount: storageObjectCount,
      totalBytes: storageTotalBytes,
      manifestSha256: storageManifestSha256,
    }
  }

  for (const [key, value] of Object.entries({
    authHooksPresent: observation?.authSmoke?.authHooksPresent,
    canaryCreated: observation?.authSmoke?.canaryCreated,
    passwordLogin: observation?.authSmoke?.passwordLogin,
    ownProfileReadable: observation?.authSmoke?.ownProfileReadable,
    otherProfilesHidden: observation?.authSmoke?.otherProfilesHidden,
    fencedCanaryDeleted: observation?.authSmoke?.fencedCanaryDeleted,
    canaryDeleted: observation?.authSmoke?.canaryDeleted,
  })) {
    if (value !== true) throw new Error(`Restore Auth smoke check failed: ${key}.`)
  }

  if (observation?.restSmoke?.anonymousPublicStatus !== 200) {
    throw new Error('Anonymous public-view smoke check did not return HTTP 200.')
  }
  const anonymousPrivateStatus = observation?.restSmoke?.anonymousPrivateStatus
  const anonymousPrivateEmpty = observation?.restSmoke?.anonymousPrivateEmpty
  if (
    ![401, 403].includes(anonymousPrivateStatus) &&
    !(anonymousPrivateStatus === 200 && anonymousPrivateEmpty === true)
  ) {
    throw new Error('Anonymous private-table smoke check did not deny or RLS-filter all rows.')
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
    restoredStorage,
    integrity: {
      orphanCounts: Object.fromEntries(orphanKeys.map((key) => [key, 0])),
      authUserApplicationTriggers: true,
      authUsersHaveProfiles: true,
      authPasswordLogin: true,
      ownProfileRls: true,
      otherProfilesHiddenByRls: true,
      anonymousPublicView: true,
      anonymousPrivateTableProtected: true,
      fencedAccountDeletion: true,
      canaryCleanedUp: true,
      storageFeatureState: featureState,
      storageBucketPrivate: featureState === 'installed' ? true : null,
      storageAnonymousAccessDenied: featureState === 'installed' ? true : null,
      storageDatabaseReferencesMatched: featureState === 'legacy-unavailable' ? null : true,
      storageObjectHashesVerified: featureState === 'legacy-unavailable' ? null : true,
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
  const storageMessage = report.restoredStorage ? ' and private Storage' : ''
  console.log(
    `Verified isolated restore drill for backup run ${report.source.runId}: ${Object.keys(report.restoredRowCounts).length} row counts${storageMessage}, and Auth/RLS smoke checks passed.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
