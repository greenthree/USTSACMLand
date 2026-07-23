import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WEBCHAT_IMAGE_BUCKET,
  WEBCHAT_IMAGE_CACHE_CONTROL,
  WEBCHAT_IMAGE_CONTENT_TYPE,
  WEBCHAT_IMAGE_FEATURE_INSTALLED,
  WEBCHAT_IMAGE_FEATURE_UNINSTALLED,
  webChatImageObjectKeyPattern,
} from './webchat-storage-backup.mjs'

const legacyArchiveEntries = [
  './',
  './SHA256SUMS',
  './auth-data.sql',
  './auth-hooks.sql',
  './data.sql',
  './metadata.txt',
  './migrations-data.sql',
  './migrations-schema.sql',
  './restore-manifest.json',
  './roles.sql',
  './schema.sql',
]

const storageArchiveEntries = [
  './storage/',
  './storage/webchat-images/',
  './storage/webchat-images/manifest.ndjson',
  './storage/webchat-images/objects/',
  './storage/webchat-images/summary.json',
]

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unexpected or missing fields.`)
  }
  return value
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in the accepted range.`)
  }
  return value
}

function parseEntry(value, index) {
  const entry = exactKeys(
    value,
    ['path', 'sha256', 'bytes', 'contentType', 'cacheControl'],
    `Storage manifest entry ${index + 1}`,
  )
  if (typeof entry.path !== 'string' || !webChatImageObjectKeyPattern.test(entry.path)) {
    throw new Error('Storage manifest contains an invalid object path.')
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error('Storage manifest contains an invalid SHA-256 digest.')
  }
  integer(entry.bytes, 'Storage manifest object bytes', 1, 4_194_304)
  if (entry.contentType !== WEBCHAT_IMAGE_CONTENT_TYPE) {
    throw new Error('Storage manifest contains an unexpected MIME type.')
  }
  if (entry.cacheControl !== WEBCHAT_IMAGE_CACHE_CONTROL) {
    throw new Error('Storage manifest contains an unexpected Cache-Control value.')
  }
  return entry
}

export function parseWebChatStorageManifest(manifestSource, summarySource) {
  const references = manifestSource
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return parseEntry(JSON.parse(line), index)
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('Storage manifest contains invalid JSON.')
        throw error
      }
    })
  for (let index = 1; index < references.length; index += 1) {
    if (references[index - 1].path >= references[index].path) {
      throw new Error('Storage manifest paths must be unique and strictly sorted.')
    }
  }

  let summary
  try {
    summary = JSON.parse(summarySource)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Storage summary contains invalid JSON.')
    throw error
  }
  if (summary?.schemaVersion === 1) {
    summary = {
      ...exactKeys(
        summary,
        ['schemaVersion', 'bucket', 'snapshotAt', 'objectCount', 'totalBytes', 'manifestSha256'],
        'Storage summary',
      ),
      featureState: WEBCHAT_IMAGE_FEATURE_INSTALLED,
    }
  } else if (summary?.schemaVersion === 2) {
    summary = exactKeys(
      summary,
      [
        'schemaVersion',
        'featureState',
        'bucket',
        'snapshotAt',
        'objectCount',
        'totalBytes',
        'manifestSha256',
      ],
      'Storage summary',
    )
    if (
      summary.featureState !== WEBCHAT_IMAGE_FEATURE_INSTALLED &&
      summary.featureState !== WEBCHAT_IMAGE_FEATURE_UNINSTALLED
    ) {
      throw new Error('Storage summary feature state is invalid.')
    }
  } else {
    throw new Error('Storage summary version is unsupported.')
  }
  if (summary.bucket !== WEBCHAT_IMAGE_BUCKET) throw new Error('Storage summary bucket is invalid.')
  if (typeof summary.snapshotAt !== 'string' || !Number.isFinite(Date.parse(summary.snapshotAt))) {
    throw new Error('Storage summary snapshot time is invalid.')
  }
  integer(summary.objectCount, 'Storage summary object count')
  integer(summary.totalBytes, 'Storage summary total bytes')
  if (
    typeof summary.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(summary.manifestSha256)
  ) {
    throw new Error('Storage summary manifest digest is invalid.')
  }
  const manifestSha256 = createHash('sha256').update(manifestSource).digest('hex')
  if (manifestSha256 !== summary.manifestSha256) {
    throw new Error('Storage manifest digest differs from its summary.')
  }
  const totalBytes = references.reduce((total, reference) => total + reference.bytes, 0)
  if (references.length !== summary.objectCount || totalBytes !== summary.totalBytes) {
    throw new Error('Storage summary aggregate values differ from its manifest.')
  }
  if (
    summary.featureState === WEBCHAT_IMAGE_FEATURE_UNINSTALLED &&
    (references.length !== 0 || summary.totalBytes !== 0)
  ) {
    throw new Error('Uninstalled WebChat image snapshot must be empty.')
  }
  return { references, summary }
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function pathInside(root, candidate) {
  const rel = relative(root, candidate)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

async function verifyObject(root, reference) {
  const path = resolve(root, ...reference.path.split('/'))
  if (!pathInside(resolve(root), path)) throw new Error('Storage object path escapes its root.')
  const info = await lstat(path).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error('Storage object is missing or is not a regular file.')
  }
  const realRoot = await realpath(root)
  const realPath = await realpath(path)
  if (!pathInside(realRoot, realPath)) throw new Error('Storage object resolves outside its root.')
  const fileStat = await stat(realPath)
  if (fileStat.size !== reference.bytes) throw new Error('Storage object byte size is invalid.')
  if ((await hashFile(realPath)) !== reference.sha256) {
    throw new Error('Storage object SHA-256 is invalid.')
  }
}

async function listTree(root, current = root) {
  const results = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    const rel = relative(root, absolute).split(sep).join('/')
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) throw new Error('Storage backup contains a symbolic link.')
    if (info.isDirectory()) results.push(...(await listTree(root, absolute)))
    else if (info.isFile()) results.push(rel)
    else throw new Error('Storage backup contains an unsupported entry type.')
  }
  return results.sort()
}

export async function verifyWebChatStorageDirectory(storageDirectory) {
  const storageRoot = resolve(storageDirectory)
  const manifestSource = await readFile(join(storageRoot, 'manifest.ndjson'), 'utf8')
  const summarySource = await readFile(join(storageRoot, 'summary.json'), 'utf8')
  const parsed = parseWebChatStorageManifest(manifestSource, summarySource)
  const expectedFiles = [
    'manifest.ndjson',
    'summary.json',
    ...parsed.references.map((reference) => `objects/${reference.path}`),
  ].sort()
  const actualFiles = await listTree(storageRoot)
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    throw new Error('Storage backup directory contains unexpected or missing files.')
  }
  const objectsRoot = join(storageRoot, 'objects')
  for (const reference of parsed.references) await verifyObject(objectsRoot, reference)
  return parsed
}

function expectedArchiveEntries(references) {
  const expected = new Set([...legacyArchiveEntries, ...storageArchiveEntries])
  for (const reference of references) {
    let directory = './storage/webchat-images/objects/'
    for (const segment of reference.path.split('/').slice(0, -1)) {
      directory += `${segment}/`
      expected.add(directory)
    }
    expected.add(`./storage/webchat-images/objects/${reference.path}`)
  }
  return [...expected].sort()
}

export function verifyEncryptedBackupListing(listingSource, manifestSource, summarySource) {
  const actual = listingSource.split(/\r?\n/).filter(Boolean)
  if (new Set(actual).size !== actual.length)
    throw new Error('Backup archive repeats a member path.')
  for (const entry of actual) {
    if (
      !entry.startsWith('./') ||
      entry.includes('\\') ||
      entry.includes('\0') ||
      entry.split('/').includes('..')
    ) {
      throw new Error('Backup archive contains an unsafe member path.')
    }
  }
  actual.sort()
  if (manifestSource === undefined && summarySource === undefined) {
    const expected = [...legacyArchiveEntries].sort()
    if (
      actual.length !== expected.length ||
      actual.some((entry, index) => entry !== expected[index])
    ) {
      throw new Error('Legacy backup archive member allowlist is invalid.')
    }
    return { artifactVersion: 1, references: [], summary: null }
  }
  if (typeof manifestSource !== 'string' || typeof summarySource !== 'string') {
    throw new Error('Storage manifest and summary must be supplied together.')
  }
  const parsed = parseWebChatStorageManifest(manifestSource, summarySource)
  const expected = expectedArchiveEntries(parsed.references)
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error('Backup archive member allowlist does not match its Storage manifest.')
  }
  return parsed
}

export async function verifyRestoredWebChatStorage(storageDirectory, downloadedParent) {
  const parsed = await verifyWebChatStorageDirectory(storageDirectory)
  const downloadedRoot = resolve(downloadedParent, WEBCHAT_IMAGE_BUCKET)
  const expectedFiles = parsed.references.map((reference) => reference.path).sort()
  const downloadedInfo = await lstat(downloadedRoot).catch(() => null)
  if (!downloadedInfo) {
    if (expectedFiles.length === 0) return parsed
    throw new Error('Restored Storage bucket download is missing.')
  }
  if (!downloadedInfo.isDirectory() || downloadedInfo.isSymbolicLink()) {
    throw new Error('Restored Storage bucket download is not a regular directory.')
  }
  const actualFiles = (await listTree(downloadedRoot)).sort()
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    throw new Error('Restored Storage contains unexpected or missing objects.')
  }
  for (const reference of parsed.references) await verifyObject(downloadedRoot, reference)
  return parsed
}

async function main() {
  const [mode, first, second, third] = process.argv.slice(2)
  if (mode === 'archive' && first && !second) {
    const parsed = await verifyWebChatStorageDirectory(first)
    console.log(
      `Verified ${parsed.summary.objectCount} encrypted WebChat image objects (${parsed.summary.totalBytes} bytes).`,
    )
    return
  }
  if (mode === 'listing' && first && (!second || third)) {
    const parsed = verifyEncryptedBackupListing(
      await readFile(resolve(first), 'utf8'),
      second ? await readFile(resolve(second), 'utf8') : undefined,
      third ? await readFile(resolve(third), 'utf8') : undefined,
    )
    console.log(
      parsed.summary
        ? `Verified encrypted backup allowlist for ${parsed.summary.objectCount} objects.`
        : 'Verified legacy encrypted backup allowlist without Storage.',
    )
    return
  }
  if (mode === 'restored' && first && second && !third) {
    const parsed = await verifyRestoredWebChatStorage(first, second)
    console.log(`Verified restored private Storage for ${parsed.summary.objectCount} objects.`)
    return
  }
  throw new Error(
    'Usage: node scripts/verify-webchat-storage-backup.mjs archive <storage-dir> | listing <listing> [<manifest> <summary>] | restored <storage-dir> <download-parent>',
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
