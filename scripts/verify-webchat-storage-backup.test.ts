import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  stageUninstalledWebChatStorageBackup,
  stageWebChatStorageBackup,
} from './webchat-storage-backup.mjs'
import {
  parseWebChatStorageManifest,
  verifyEncryptedBackupListing,
  verifyWebChatStorageDirectory,
} from './verify-webchat-storage-backup.mjs'
import { buildWebChatStorageRestoreObservation } from './verify-webchat-storage-restore.mjs'

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const attachmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const objectKey = `user/${userId}/conversation/${conversationId}/attachment/${attachmentId}.webp`
const bytes = Buffer.from('verified-normalized-webp')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const reference = {
  path: objectKey,
  sha256,
  bytes: bytes.length,
  contentType: 'image/webp',
  cacheControl: '0',
}
const columns =
  'id, user_id, conversation_id, status, bucket_id, object_key, normalized_mime, object_bytes, sha256'
const dataSql = [
  `COPY private.webchat_image_attachments (${columns}) FROM stdin;`,
  [
    attachmentId,
    userId,
    conversationId,
    'attached',
    'webchat-images',
    objectKey,
    'image/webp',
    String(bytes.length),
    sha256,
  ].join('\t'),
  '\\.',
  '',
].join('\n')
const storageDataSql = [
  'COPY storage.objects (bucket_id, name, metadata) FROM stdin;',
  [
    'webchat-images',
    objectKey,
    JSON.stringify({
      size: bytes.length,
      contentLength: bytes.length,
      mimetype: 'image/webp',
      cacheControl: '0',
    }),
  ].join('\t'),
  '\\.',
  '',
].join('\n')
const emptyStorageDataSql = 'COPY storage.objects (bucket_id, name, metadata) FROM stdin;\n\\.\n'
const metadata = 'created_at=2026-07-23T00:30:00Z\n'

const fixedListing = [
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
  './storage/',
  './storage/webchat-images/',
  './storage/webchat-images/manifest.ndjson',
  './storage/webchat-images/objects/',
  './storage/webchat-images/objects/user/',
  `./storage/webchat-images/objects/user/${userId}/`,
  `./storage/webchat-images/objects/user/${userId}/conversation/`,
  `./storage/webchat-images/objects/user/${userId}/conversation/${conversationId}/`,
  `./storage/webchat-images/objects/user/${userId}/conversation/${conversationId}/attachment/`,
  `./storage/webchat-images/objects/${objectKey}`,
  './storage/webchat-images/summary.json',
]

describe('encrypted WebChat Storage verification', () => {
  let root = ''
  let storageDirectory = ''
  let manifestSource = ''
  let summarySource = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'usts-webchat-storage-verify-'))
    const downloadParent = join(root, 'source')
    const sourcePath = join(downloadParent, 'webchat-images', ...objectKey.split('/'))
    await mkdir(join(sourcePath, '..'), { recursive: true })
    await writeFile(sourcePath, bytes)
    storageDirectory = join(root, 'archive', 'storage', 'webchat-images')
    await stageWebChatStorageBackup({
      dataSql,
      storageDataSql,
      metadataSource: metadata,
      downloadParent,
      outputDirectory: storageDirectory,
      maxObjects: 10,
      maxBytes: 1_000_000,
    })
    manifestSource = await readFile(join(storageDirectory, 'manifest.ndjson'), 'utf8')
    summarySource = await readFile(join(storageDirectory, 'summary.json'), 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('verifies exact archive files and the dynamic tar member allowlist', async () => {
    const parsed = await verifyWebChatStorageDirectory(storageDirectory)
    expect(parsed.references).toEqual([reference])
    expect(
      verifyEncryptedBackupListing(`${fixedListing.join('\n')}\n`, manifestSource, summarySource)
        .summary,
    ).toMatchObject({ objectCount: 1, totalBytes: bytes.length })
  })

  it('normalizes a v1 Storage summary as an installed feature', () => {
    const current = JSON.parse(summarySource)
    const legacySummary = { ...current }
    delete legacySummary.featureState
    expect(
      parseWebChatStorageManifest(
        manifestSource,
        JSON.stringify({ ...legacySummary, schemaVersion: 1 }),
      ).summary.featureState,
    ).toBe('installed')
  })

  it('rejects unexpected archive files, unsafe members, and manifest tampering', async () => {
    await writeFile(join(storageDirectory, 'unexpected.txt'), 'not allowed')
    await expect(verifyWebChatStorageDirectory(storageDirectory)).rejects.toThrow(/unexpected/)

    expect(() =>
      verifyEncryptedBackupListing(
        `${fixedListing.join('\n')}\n./storage/webchat-images/objects/../escape\n`,
        manifestSource,
        summarySource,
      ),
    ).toThrow(/unsafe|allowlist/)

    const tamperedManifest = manifestSource.replace(sha256, 'f'.repeat(64))
    expect(() => parseWebChatStorageManifest(tamperedManifest, summarySource)).toThrow(
      /digest differs/,
    )
  })

  it('verifies restored bytes and exact database references without exposing object paths', async () => {
    const downloadedParent = join(root, 'restored')
    const restoredPath = join(downloadedParent, 'webchat-images', ...objectKey.split('/'))
    await mkdir(join(restoredPath, '..'), { recursive: true })
    await writeFile(restoredPath, bytes)
    const observation = await buildWebChatStorageRestoreObservation({
      storageDirectory,
      downloadedParent,
      databaseReferencesSource: `${JSON.stringify(reference)}\n`,
      bucketPrivate: true,
      anonymousDenied: true,
    })

    expect(observation).toEqual({
      featureState: 'installed',
      bucket: 'webchat-images',
      objectCount: 1,
      totalBytes: bytes.length,
      manifestSha256: createHash('sha256').update(manifestSource).digest('hex'),
      featureAbsent: false,
      bucketPrivate: true,
      anonymousDenied: true,
      databaseReferencesMatched: true,
      objectHashesVerified: true,
      objectMetadataMatched: true,
    })
    expect(JSON.stringify(observation)).not.toContain(userId)
    expect(JSON.stringify(observation)).not.toContain(objectKey)
  })

  it('fails restored verification for public access, database drift, or byte drift', async () => {
    const downloadedParent = join(root, 'restored')
    const restoredPath = join(downloadedParent, 'webchat-images', ...objectKey.split('/'))
    await mkdir(join(restoredPath, '..'), { recursive: true })
    await writeFile(restoredPath, bytes)

    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory,
        downloadedParent,
        databaseReferencesSource: `${JSON.stringify(reference)}\n`,
        bucketPrivate: false,
        anonymousDenied: true,
      }),
    ).rejects.toThrow(/not private/)

    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory,
        downloadedParent,
        databaseReferencesSource: '',
        bucketPrivate: true,
        anonymousDenied: true,
      }),
    ).rejects.toThrow(/database image references differ/)

    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory,
        downloadedParent,
        databaseReferencesSource: `${JSON.stringify({ ...reference, cacheControl: '3600' })}\n`,
        bucketPrivate: true,
        anonymousDenied: true,
      }),
    ).rejects.toThrow(/database image references differ/)

    await writeFile(restoredPath, Buffer.from('corrupt'))
    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory,
        downloadedParent,
        databaseReferencesSource: `${JSON.stringify(reference)}\n`,
        bucketPrivate: true,
        anonymousDenied: true,
      }),
    ).rejects.toThrow(/byte size|SHA-256/)
  })

  it('accepts a missing downloaded bucket directory only for an empty snapshot', async () => {
    const emptyStorageDirectory = join(root, 'empty-archive', 'storage', 'webchat-images')
    await stageWebChatStorageBackup({
      dataSql: dataSql.replace('\tattached\t', '\tdeleted\t'),
      storageDataSql: emptyStorageDataSql,
      metadataSource: metadata,
      downloadParent: join(root, 'missing-source'),
      outputDirectory: emptyStorageDirectory,
      maxObjects: 0,
      maxBytes: 1,
    })

    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory: emptyStorageDirectory,
        downloadedParent: join(root, 'missing-restored'),
        databaseReferencesSource: '',
        bucketPrivate: true,
        anonymousDenied: true,
      }),
    ).resolves.toMatchObject({ objectCount: 0, totalBytes: 0 })

    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory,
        downloadedParent: join(root, 'missing-restored'),
        databaseReferencesSource: `${JSON.stringify(reference)}\n`,
        bucketPrivate: true,
        anonymousDenied: true,
      }),
    ).rejects.toThrow(/download is missing/)
  })

  it('verifies an explicit uninstalled snapshot without inventing bucket checks', async () => {
    const uninstalledDirectory = join(root, 'uninstalled', 'storage', 'webchat-images')
    await stageUninstalledWebChatStorageBackup({
      metadataSource: metadata,
      outputDirectory: uninstalledDirectory,
    })

    await expect(
      buildWebChatStorageRestoreObservation({
        storageDirectory: uninstalledDirectory,
        downloadedParent: join(root, 'missing-restored'),
        databaseReferencesSource: '',
        bucketPrivate: null,
        anonymousDenied: null,
        featureInstalled: false,
      }),
    ).resolves.toMatchObject({
      featureState: 'uninstalled',
      featureAbsent: true,
      objectCount: 0,
      totalBytes: 0,
      bucketPrivate: null,
      anonymousDenied: null,
    })
  })

  it('accepts the exact legacy archive allowlist only without Storage arguments', () => {
    const legacyListing = fixedListing.filter((entry) => !entry.startsWith('./storage'))
    expect(verifyEncryptedBackupListing(`${legacyListing.join('\n')}\n`)).toMatchObject({
      artifactVersion: 1,
      summary: null,
    })
    expect(() => verifyEncryptedBackupListing(`${fixedListing.join('\n')}\n`)).toThrow(
      /Legacy backup archive member allowlist/,
    )
  })
})
