import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function timestamp(value, label) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp.`)
  return parsed
}

export function verifyBackupRecoveryFloor(metadataSource, currentFloor) {
  const metadata = parseMetadata(metadataSource)
  const createdAt = timestamp(metadata.get('created_at'), 'Backup creation time')
  const recordedFloor = timestamp(metadata.get('recovery_not_before'), 'Backup recovery floor')
  const requiredFloor = timestamp(currentFloor, 'Current repository recovery floor')

  if (requiredFloor < recordedFloor) {
    throw new Error(
      'Current repository recovery floor is older than the value recorded in this backup; stop and investigate possible variable regression.',
    )
  }
  if (createdAt < requiredFloor) {
    throw new Error(
      'Backup predates the current account-deletion recovery floor and must not be restored.',
    )
  }

  return {
    createdAt: new Date(createdAt).toISOString(),
    recoveryNotBefore: new Date(requiredFloor).toISOString(),
  }
}

async function main() {
  const metadataPath = process.argv[2]
  if (!metadataPath) {
    throw new Error('Usage: node scripts/verify-backup-recovery-floor.mjs <metadata.txt>')
  }
  const currentFloor = process.env.BACKUP_RECOVERY_NOT_BEFORE
  if (!currentFloor) {
    throw new Error('BACKUP_RECOVERY_NOT_BEFORE must be copied from the current GitHub variable.')
  }
  const report = verifyBackupRecoveryFloor(
    await readFile(resolve(metadataPath), 'utf8'),
    currentFloor,
  )
  console.log(
    `Verified backup recovery floor: backup ${report.createdAt}, current floor ${report.recoveryNotBefore}.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
