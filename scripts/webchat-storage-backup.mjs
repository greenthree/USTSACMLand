import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEBCHAT_IMAGE_BUCKET = 'webchat-images'
export const WEBCHAT_IMAGE_CONTENT_TYPE = 'image/webp'
export const WEBCHAT_IMAGE_CACHE_CONTROL = '0'
export const WEBCHAT_IMAGE_FEATURE_INSTALLED = 'installed'
export const WEBCHAT_IMAGE_FEATURE_UNINSTALLED = 'uninstalled'

const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const webChatImageObjectKeyPattern = new RegExp(
  `^user/(${uuidPattern})/conversation/(${uuidPattern})/attachment/(${uuidPattern})\\.webp$`,
)

const targetTable = 'private.webchat_image_attachments'
const storageObjectsTable = 'storage.objects'
const requiredColumns = [
  'id',
  'user_id',
  'conversation_id',
  'status',
  'bucket_id',
  'object_key',
  'normalized_mime',
  'object_bytes',
  'sha256',
]

function unquoteIdentifier(quoted, plain) {
  return quoted === undefined ? plain : quoted.replaceAll('""', '"')
}

function parseCopyHeader(line) {
  const match = line.match(
    /^COPY\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\.(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s+\(([^)]*)\)\s+FROM stdin;$/,
  )
  if (!match) return null
  const schema = unquoteIdentifier(match[1], match[2])
  const table = unquoteIdentifier(match[3], match[4])
  const columns = match[5].split(',').map((value) => {
    const token = value.trim()
    const quoted = token.match(/^"((?:[^"]|"")+)"$/)
    if (quoted) return quoted[1].replaceAll('""', '"')
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(token)) {
      throw new Error(`Backup dump contains an invalid COPY column: ${token}.`)
    }
    return token
  })
  return { table: `${schema}.${table}`, columns }
}

export function decodePostgresCopyText(value) {
  if (value === '\\N') return null
  let decoded = ''
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]
    if (current !== '\\') {
      decoded += current
      continue
    }
    index += 1
    if (index >= value.length) throw new Error('Backup COPY value ends with an escape character.')
    const escaped = value[index]
    const simple = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
    }[escaped]
    if (simple !== undefined) {
      decoded += simple
      continue
    }
    if (escaped === 'x') {
      const hex = value.slice(index + 1, index + 3)
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error('Backup COPY value has invalid hex.')
      decoded += String.fromCharCode(Number.parseInt(hex, 16))
      index += 2
      continue
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped
      while (octal.length < 3 && /[0-7]/.test(value[index + 1] ?? '')) {
        index += 1
        octal += value[index]
      }
      decoded += String.fromCharCode(Number.parseInt(octal, 8))
      continue
    }
    decoded += escaped
  }
  return decoded
}

function integer(value, label, minimum, maximum) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} is not an integer.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} is outside the accepted range.`)
  }
  return parsed
}

function validateReference(row) {
  const status = row.status
  if (status !== 'ready' && status !== 'attached') return null
  const id = row.id
  const userId = row.user_id
  const conversationId = row.conversation_id
  const objectKey = row.object_key
  if (
    typeof id !== 'string' ||
    typeof userId !== 'string' ||
    typeof conversationId !== 'string' ||
    typeof objectKey !== 'string'
  ) {
    throw new Error('Stored WebChat image reference is missing its identity fields.')
  }
  const objectMatch = objectKey.match(webChatImageObjectKeyPattern)
  if (
    !objectMatch ||
    objectMatch[1] !== userId ||
    objectMatch[2] !== conversationId ||
    objectMatch[3] !== id
  ) {
    throw new Error('Stored WebChat image object key is not scoped to its attachment identity.')
  }
  if (row.bucket_id !== WEBCHAT_IMAGE_BUCKET) {
    throw new Error('Stored WebChat image references an unexpected bucket.')
  }
  if (row.normalized_mime !== WEBCHAT_IMAGE_CONTENT_TYPE) {
    throw new Error('Stored WebChat image has an unexpected normalized MIME type.')
  }
  if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) {
    throw new Error('Stored WebChat image has an invalid SHA-256 digest.')
  }
  return {
    path: objectKey,
    sha256: row.sha256,
    bytes: integer(row.object_bytes, 'Stored WebChat image byte size', 1, 4_194_304),
  }
}

function extractDatabaseImageReferences(dataSql) {
  let active = null
  let found = false
  const references = []

  for (const line of dataSql.split(/\r?\n/)) {
    if (active) {
      if (line === '\\.') {
        active = null
        continue
      }
      const values = line.split('\t')
      if (values.length !== active.columns.length) {
        throw new Error('WebChat image COPY row does not match its declared columns.')
      }
      const row = Object.fromEntries(
        active.columns.map((column, index) => [column, decodePostgresCopyText(values[index])]),
      )
      const reference = validateReference(row)
      if (reference) references.push(reference)
      continue
    }

    const header = parseCopyHeader(line)
    if (!header || header.table !== targetTable) continue
    if (found) throw new Error(`Backup dump repeats COPY data for ${targetTable}.`)
    found = true
    for (const column of requiredColumns) {
      if (!header.columns.includes(column)) {
        throw new Error(`Backup dump is missing ${targetTable}.${column}.`)
      }
    }
    active = header
  }

  if (active) throw new Error(`Backup dump has an unterminated COPY block for ${targetTable}.`)
  if (!found) throw new Error(`Backup dump is missing COPY data for ${targetTable}.`)

  references.sort((left, right) => left.path.localeCompare(right.path))
  for (let index = 1; index < references.length; index += 1) {
    if (references[index - 1].path === references[index].path) {
      throw new Error('Backup dump repeats a WebChat image object key.')
    }
  }
  return references
}

export function extractWebChatStorageObjectMetadata(storageDataSql) {
  let active = null
  let found = false
  const metadataByPath = new Map()

  for (const line of storageDataSql.split(/\r?\n/)) {
    if (active) {
      if (line === '\\.') {
        active = null
        continue
      }
      const values = line.split('\t')
      if (values.length !== active.columns.length) {
        throw new Error('Storage object COPY row does not match its declared columns.')
      }
      const row = Object.fromEntries(
        active.columns.map((column, index) => [column, decodePostgresCopyText(values[index])]),
      )
      if (row.bucket_id !== WEBCHAT_IMAGE_BUCKET) continue
      if (typeof row.name !== 'string' || metadataByPath.has(row.name)) {
        throw new Error('Storage metadata repeats or omits a WebChat image object path.')
      }

      let metadata
      try {
        metadata = JSON.parse(row.metadata ?? '')
      } catch {
        throw new Error('Stored WebChat image object metadata is invalid JSON.')
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('Stored WebChat image object metadata is invalid.')
      }
      const size = integer(
        String(metadata.size),
        'Stored WebChat object metadata size',
        1,
        4_194_304,
      )
      const contentLength = integer(
        String(metadata.contentLength),
        'Stored WebChat object metadata content length',
        1,
        4_194_304,
      )
      if (size !== contentLength) {
        throw new Error('Stored WebChat object metadata byte sizes disagree.')
      }
      if (metadata.mimetype !== WEBCHAT_IMAGE_CONTENT_TYPE) {
        throw new Error('Stored WebChat image object metadata has an unexpected MIME type.')
      }
      if (metadata.cacheControl !== WEBCHAT_IMAGE_CACHE_CONTROL) {
        throw new Error(
          'Stored WebChat image object metadata has an unexpected Cache-Control value.',
        )
      }
      metadataByPath.set(row.name, {
        bytes: size,
        contentType: metadata.mimetype,
        cacheControl: metadata.cacheControl,
      })
      continue
    }

    const header = parseCopyHeader(line)
    if (!header || header.table !== storageObjectsTable) continue
    if (found) throw new Error(`Backup dump repeats COPY data for ${storageObjectsTable}.`)
    found = true
    for (const column of ['bucket_id', 'name', 'metadata']) {
      if (!header.columns.includes(column)) {
        throw new Error(`Backup dump is missing ${storageObjectsTable}.${column}.`)
      }
    }
    active = header
  }

  if (active)
    throw new Error(`Backup dump has an unterminated COPY block for ${storageObjectsTable}.`)
  if (!found) throw new Error(`Backup dump is missing COPY data for ${storageObjectsTable}.`)
  return metadataByPath
}

export function extractWebChatImageReferences(dataSql, storageDataSql) {
  const references = extractDatabaseImageReferences(dataSql)
  const metadataByPath = extractWebChatStorageObjectMetadata(storageDataSql)
  return references.map((reference) => {
    const metadata = metadataByPath.get(reference.path)
    if (!metadata) {
      throw new Error('A database-referenced WebChat image has no Storage metadata row.')
    }
    if (metadata.bytes !== reference.bytes) {
      throw new Error('A WebChat image Storage metadata size differs from the database snapshot.')
    }
    return { ...reference, contentType: metadata.contentType, cacheControl: metadata.cacheControl }
  })
}

function parseSnapshotAt(metadataSource) {
  const values = new Map()
  for (const line of metadataSource.split(/\r?\n/)) {
    if (!line) continue
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error('Backup metadata contains an invalid line.')
    const key = line.slice(0, separator)
    if (values.has(key)) throw new Error(`Backup metadata repeats ${key}.`)
    values.set(key, line.slice(separator + 1))
  }
  const createdAt = values.get('created_at')
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error('Backup metadata created_at is not a valid timestamp.')
  }
  return new Date(createdAt).toISOString()
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function inside(root, candidate) {
  const rel = relative(root, candidate)
  return rel !== '' && !isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== '..'
}

async function verifiedSourcePath(bucketRoot, reference) {
  const sourcePath = resolve(bucketRoot, ...reference.path.split('/'))
  if (!inside(resolve(bucketRoot), sourcePath)) {
    throw new Error('WebChat image path escapes the downloaded bucket root.')
  }
  const sourceInfo = await lstat(sourcePath).catch(() => null)
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error('A referenced WebChat image is missing or is not a regular file.')
  }
  const realBucketRoot = await realpath(bucketRoot)
  const realSourcePath = await realpath(sourcePath)
  if (!inside(realBucketRoot, realSourcePath)) {
    throw new Error('A referenced WebChat image resolves outside the downloaded bucket root.')
  }
  const sourceStat = await stat(realSourcePath)
  if (sourceStat.size !== reference.bytes) {
    throw new Error('A referenced WebChat image byte size differs from the database snapshot.')
  }
  if ((await hashFile(realSourcePath)) !== reference.sha256) {
    throw new Error('A referenced WebChat image SHA-256 differs from the database snapshot.')
  }
  return realSourcePath
}

export function serializeWebChatStorageManifest(references) {
  return references.length === 0
    ? ''
    : `${references.map((reference) => JSON.stringify(reference)).join('\n')}\n`
}

export function inspectWebChatStorageSnapshot(dataSql, storageDataSql, maxObjects, maxBytes) {
  const references = extractWebChatImageReferences(dataSql, storageDataSql)
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 0) {
    throw new Error('MAX_STORAGE_OBJECTS must be a non-negative integer.')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('MAX_BACKUP_ARTIFACT_BYTES must be a positive integer.')
  }
  if (references.length > maxObjects) {
    throw new Error('WebChat image object count exceeds MAX_STORAGE_OBJECTS.')
  }
  const totalBytes = references.reduce((total, reference) => total + reference.bytes, 0)
  if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
    throw new Error('WebChat image bytes exceed MAX_BACKUP_ARTIFACT_BYTES.')
  }
  return {
    featureState: WEBCHAT_IMAGE_FEATURE_INSTALLED,
    references,
    objectCount: references.length,
    totalBytes,
  }
}

async function writeStorageSnapshot(outputDirectory, metadataSource, featureState, references) {
  const outputRoot = resolve(outputDirectory)
  await mkdir(join(outputRoot, 'objects'), { recursive: true, mode: 0o700 })
  const manifestSource = serializeWebChatStorageManifest(references)
  const summary = {
    schemaVersion: 2,
    featureState,
    bucket: WEBCHAT_IMAGE_BUCKET,
    snapshotAt: parseSnapshotAt(metadataSource),
    objectCount: references.length,
    totalBytes: references.reduce((total, reference) => total + reference.bytes, 0),
    manifestSha256: createHash('sha256').update(manifestSource).digest('hex'),
  }
  await writeFile(join(outputRoot, 'manifest.ndjson'), manifestSource, { mode: 0o600 })
  await writeFile(join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    mode: 0o600,
  })
  return summary
}

export async function stageUninstalledWebChatStorageBackup({ metadataSource, outputDirectory }) {
  const summary = await writeStorageSnapshot(
    outputDirectory,
    metadataSource,
    WEBCHAT_IMAGE_FEATURE_UNINSTALLED,
    [],
  )
  return { references: [], summary }
}

export async function stageWebChatStorageBackup({
  dataSql,
  storageDataSql,
  metadataSource,
  downloadParent,
  outputDirectory,
  maxObjects,
  maxBytes,
}) {
  const { references, totalBytes } = inspectWebChatStorageSnapshot(
    dataSql,
    storageDataSql,
    maxObjects,
    maxBytes,
  )

  const outputRoot = resolve(outputDirectory)
  const objectsRoot = join(outputRoot, 'objects')
  const bucketRoot = resolve(downloadParent, WEBCHAT_IMAGE_BUCKET)
  await mkdir(objectsRoot, { recursive: true, mode: 0o700 })

  for (const reference of references) {
    const sourcePath = await verifiedSourcePath(bucketRoot, reference)
    const destinationPath = join(objectsRoot, ...reference.path.split('/'))
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
    await copyFile(sourcePath, destinationPath)
    await chmod(destinationPath, 0o600)
  }

  const summary = await writeStorageSnapshot(
    outputRoot,
    metadataSource,
    WEBCHAT_IMAGE_FEATURE_INSTALLED,
    references,
  )
  if (summary.totalBytes !== totalBytes) {
    throw new Error('Staged WebChat image bytes differ from the inspected snapshot.')
  }
  return { references, summary }
}

function parseLimit(value, name, allowZero) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`${name} must be an integer.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${name} is outside the accepted range.`)
  }
  return parsed
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'uninstalled') {
    const [, outputDirectory, metadataPath] = args
    if (!metadataPath) {
      throw new Error(
        'Usage: node scripts/webchat-storage-backup.mjs uninstalled <output-directory> <metadata.txt>',
      )
    }
    const result = await stageUninstalledWebChatStorageBackup({
      metadataSource: await readFile(resolve(metadataPath), 'utf8'),
      outputDirectory,
    })
    console.log(
      `Staged explicit ${result.summary.featureState} WebChat image snapshot (0 objects).`,
    )
    return
  }
  if (args[0] === 'inspect') {
    const [, dataPath, storageDataPath, maxObjects, maxBytes] = args
    if (!maxBytes) {
      throw new Error(
        'Usage: node scripts/webchat-storage-backup.mjs inspect <data.sql> <storage-data.sql> <max-objects> <max-bytes>',
      )
    }
    const summary = inspectWebChatStorageSnapshot(
      await readFile(resolve(dataPath), 'utf8'),
      await readFile(resolve(storageDataPath), 'utf8'),
      parseLimit(maxObjects, 'MAX_STORAGE_OBJECTS', true),
      parseLimit(maxBytes, 'MAX_BACKUP_ARTIFACT_BYTES', false),
    )
    console.log(
      JSON.stringify({ objectCount: summary.objectCount, totalBytes: summary.totalBytes }),
    )
    return
  }

  if (args[0] === 'plan') {
    const [, dataPath, storageDataPath, maxObjects, maxBytes] = args
    if (!maxBytes) {
      throw new Error(
        'Usage: node scripts/webchat-storage-backup.mjs plan <data.sql> <storage-data.sql> <max-objects> <max-bytes>',
      )
    }
    const summary = inspectWebChatStorageSnapshot(
      await readFile(resolve(dataPath), 'utf8'),
      await readFile(resolve(storageDataPath), 'utf8'),
      parseLimit(maxObjects, 'MAX_STORAGE_OBJECTS', true),
      parseLimit(maxBytes, 'MAX_BACKUP_ARTIFACT_BYTES', false),
    )
    console.log(JSON.stringify(summary))
    return
  }

  const [
    dataPath,
    storageDataPath,
    downloadParent,
    outputDirectory,
    metadataPath,
    maxObjects,
    maxBytes,
  ] = args
  if (!maxBytes) {
    throw new Error(
      'Usage: node scripts/webchat-storage-backup.mjs <data.sql> <storage-data.sql> <download-parent> <output-directory> <metadata.txt> <max-objects> <max-bytes>',
    )
  }
  const result = await stageWebChatStorageBackup({
    dataSql: await readFile(resolve(dataPath), 'utf8'),
    storageDataSql: await readFile(resolve(storageDataPath), 'utf8'),
    metadataSource: await readFile(resolve(metadataPath), 'utf8'),
    downloadParent,
    outputDirectory,
    maxObjects: parseLimit(maxObjects, 'MAX_STORAGE_OBJECTS', true),
    maxBytes: parseLimit(maxBytes, 'MAX_BACKUP_ARTIFACT_BYTES', false),
  })
  console.log(
    `Staged ${result.summary.objectCount} private WebChat image objects (${result.summary.totalBytes} bytes).`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
