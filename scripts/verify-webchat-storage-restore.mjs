import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseWebChatStorageManifest,
  verifyRestoredWebChatStorage,
} from './verify-webchat-storage-backup.mjs'

function parseDatabaseReferences(source) {
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      let value
      try {
        value = JSON.parse(line)
      } catch {
        throw new Error('Restored WebChat image database reference is invalid JSON.')
      }
      const keys = Object.keys(value ?? {}).sort()
      const expected = ['bytes', 'cacheControl', 'contentType', 'path', 'sha256'].sort()
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new Error('Restored WebChat image database reference has invalid fields.')
      }
      return value
    })
}

export async function buildWebChatStorageRestoreObservation({
  storageDirectory,
  downloadedParent,
  databaseReferencesSource,
  bucketPrivate,
  anonymousDenied,
  featureInstalled,
}) {
  const restored = await verifyRestoredWebChatStorage(storageDirectory, downloadedParent)
  const manifestSource = await readFile(resolve(storageDirectory, 'manifest.ndjson'), 'utf8')
  const summarySource = await readFile(resolve(storageDirectory, 'summary.json'), 'utf8')
  const parsed = parseWebChatStorageManifest(manifestSource, summarySource)
  const isInstalled = parsed.summary.featureState === 'installed'
  if (isInstalled) {
    if (featureInstalled === false) {
      throw new Error('Restore boundary reports the WebChat image feature as uninstalled.')
    }
    if (bucketPrivate !== true) throw new Error('Restored WebChat image bucket is not private.')
    if (anonymousDenied !== true) throw new Error('Anonymous WebChat image access was not denied.')
  } else if (featureInstalled !== false) {
    throw new Error('Restore boundary did not confirm the WebChat image feature is uninstalled.')
  }
  const databaseReferences = parseDatabaseReferences(databaseReferencesSource)
  databaseReferences.sort((left, right) => String(left.path).localeCompare(String(right.path)))
  if (JSON.stringify(databaseReferences) !== JSON.stringify(parsed.references)) {
    throw new Error(
      'Restored database image references differ from the encrypted Storage manifest.',
    )
  }
  if (restored.summary.manifestSha256 !== parsed.summary.manifestSha256) {
    throw new Error('Restored Storage verification used a different manifest.')
  }
  return {
    featureState: parsed.summary.featureState,
    bucket: parsed.summary.bucket,
    objectCount: parsed.summary.objectCount,
    totalBytes: parsed.summary.totalBytes,
    manifestSha256: parsed.summary.manifestSha256,
    featureAbsent: !isInstalled,
    bucketPrivate: isInstalled ? true : null,
    anonymousDenied: isInstalled ? true : null,
    databaseReferencesMatched: true,
    objectHashesVerified: true,
    objectMetadataMatched: true,
  }
}

async function main() {
  const [storageDirectory, downloadedParent, databaseReferencesPath, boundaryPath, outputPath] =
    process.argv.slice(2)
  if (!outputPath) {
    throw new Error(
      'Usage: node scripts/verify-webchat-storage-restore.mjs <storage-dir> <download-parent> <database-references.ndjson> <boundary.json> <output.json>',
    )
  }
  const boundary = JSON.parse(await readFile(resolve(boundaryPath), 'utf8'))
  const observation = await buildWebChatStorageRestoreObservation({
    storageDirectory,
    downloadedParent,
    databaseReferencesSource: await readFile(resolve(databaseReferencesPath), 'utf8'),
    bucketPrivate: boundary.bucketPrivate,
    anonymousDenied: boundary.anonymousDenied,
    featureInstalled: boundary.featureInstalled,
  })
  await writeFile(resolve(outputPath), `${JSON.stringify(observation, null, 2)}\n`, { mode: 0o600 })
  console.log(
    `Verified isolated WebChat image restore for ${observation.objectCount} objects (${observation.totalBytes} bytes).`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
