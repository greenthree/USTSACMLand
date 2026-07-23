import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  decodePostgresCopyText,
  extractWebChatImageReferences,
  extractWebChatStorageObjectMetadata,
  inspectWebChatStorageSnapshot,
  stageUninstalledWebChatStorageBackup,
  stageWebChatStorageBackup,
} from './webchat-storage-backup.mjs'

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const attachmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const objectKey = `user/${userId}/conversation/${conversationId}/attachment/${attachmentId}.webp`
const bytes = Buffer.from('normalized-webp-fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const columns = [
  'id',
  'user_id',
  'conversation_id',
  'message_id',
  'status',
  'bucket_id',
  'object_key',
  'original_mime',
  'original_bytes',
  'normalized_mime',
  'object_bytes',
  'width',
  'height',
  'sha256',
]

function row(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    id: attachmentId,
    user_id: userId,
    conversation_id: conversationId,
    message_id: null,
    status: 'ready',
    bucket_id: 'webchat-images',
    object_key: objectKey,
    original_mime: 'image/png',
    original_bytes: String(bytes.length),
    normalized_mime: 'image/webp',
    object_bytes: String(bytes.length),
    width: '32',
    height: '32',
    sha256,
    ...overrides,
  }
  return columns.map((column) => values[column] ?? '\\N').join('\t')
}

function dump(...rows: string[]) {
  return [
    `COPY private.webchat_image_attachments (${columns.join(', ')}) FROM stdin;`,
    ...rows,
    '\\.',
    '',
  ].join('\n')
}

const metadata = 'created_at=2026-07-23T00:30:00Z\nrepository=test/repo\n'
const storageColumns = ['bucket_id', 'name', 'metadata']

function storageRow(overrides: Record<string, string> = {}) {
  const values = {
    bucket_id: 'webchat-images',
    name: objectKey,
    metadata: JSON.stringify({
      size: bytes.length,
      contentLength: bytes.length,
      mimetype: 'image/webp',
      cacheControl: '0',
    }),
    ...overrides,
  }
  return storageColumns.map((column) => values[column as keyof typeof values]).join('\t')
}

function storageDump(...rows: string[]) {
  return [
    `COPY storage.objects (${storageColumns.join(', ')}) FROM stdin;`,
    ...rows,
    '\\.',
    '',
  ].join('\n')
}

describe('WebChat Storage backup snapshot', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'usts-webchat-storage-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('decodes PostgreSQL COPY text escapes without treating null as text', () => {
    expect(decodePostgresCopyText('line\\tvalue\\nnext')).toBe('line\tvalue\nnext')
    expect(decodePostgresCopyText('slash\\\\value')).toBe('slash\\value')
    expect(decodePostgresCopyText('\\N')).toBeNull()
  })

  it('extracts only ready or attached immutable image references', () => {
    const references = extractWebChatImageReferences(
      dump(row(), row({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'validating' })),
      storageDump(storageRow()),
    )
    expect(references).toEqual([
      {
        path: objectKey,
        sha256,
        bytes: bytes.length,
        contentType: 'image/webp',
        cacheControl: '0',
      },
    ])
  })

  it('accepts canonical UUIDs without restricting future UUID versions', () => {
    const futureUserId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
    const futureConversationId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
    const futureAttachmentId = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
    const futureObjectKey =
      `user/${futureUserId}/conversation/${futureConversationId}` +
      `/attachment/${futureAttachmentId}.webp`

    expect(
      extractWebChatImageReferences(
        dump(
          row({
            id: futureAttachmentId,
            user_id: futureUserId,
            conversation_id: futureConversationId,
            object_key: futureObjectKey,
          }),
        ),
        storageDump(storageRow({ name: futureObjectKey })),
      )[0].path,
    ).toBe(futureObjectKey)
  })

  it('stages the database snapshot object set and emits a canonical manifest', async () => {
    const downloadParent = join(root, 'download')
    const sourcePath = join(downloadParent, 'webchat-images', ...objectKey.split('/'))
    await mkdir(join(sourcePath, '..'), { recursive: true })
    await writeFile(sourcePath, bytes)
    const outputDirectory = join(root, 'backup', 'storage', 'webchat-images')

    const result = await stageWebChatStorageBackup({
      dataSql: dump(row()),
      storageDataSql: storageDump(storageRow()),
      metadataSource: metadata,
      downloadParent,
      outputDirectory,
      maxObjects: 10,
      maxBytes: 1_000_000,
    })

    expect(result.summary).toMatchObject({
      schemaVersion: 2,
      featureState: 'installed',
      bucket: 'webchat-images',
      snapshotAt: '2026-07-23T00:30:00.000Z',
      objectCount: 1,
      totalBytes: bytes.length,
    })
    expect(await readFile(join(outputDirectory, 'objects', ...objectKey.split('/')))).toEqual(bytes)
    expect(await readFile(join(outputDirectory, 'manifest.ndjson'), 'utf8')).toBe(
      `${JSON.stringify(result.references[0])}\n`,
    )
  })

  it('supports an empty referenced-object snapshot without requiring a downloaded directory', async () => {
    const outputDirectory = join(root, 'empty')
    const result = await stageWebChatStorageBackup({
      dataSql: dump(row({ status: 'deleted' })),
      storageDataSql: storageDump(),
      metadataSource: metadata,
      downloadParent: join(root, 'missing-download'),
      outputDirectory,
      maxObjects: 0,
      maxBytes: 1,
    })
    expect(result.summary).toMatchObject({ objectCount: 0, totalBytes: 0 })
    expect(await readFile(join(outputDirectory, 'manifest.ndjson'), 'utf8')).toBe('')
  })

  it('emits an explicit empty snapshot when the feature is not installed', async () => {
    const outputDirectory = join(root, 'uninstalled')
    const result = await stageUninstalledWebChatStorageBackup({
      metadataSource: metadata,
      outputDirectory,
    })

    expect(result.summary).toMatchObject({
      schemaVersion: 2,
      featureState: 'uninstalled',
      bucket: 'webchat-images',
      objectCount: 0,
      totalBytes: 0,
      manifestSha256: createHash('sha256').update('').digest('hex'),
    })
    expect(await readFile(join(outputDirectory, 'manifest.ndjson'), 'utf8')).toBe('')
  })

  it('produces a path-free pre-download plan and applies both configured limits', () => {
    const plan = inspectWebChatStorageSnapshot(
      dump(row()),
      storageDump(storageRow()),
      10,
      1_000_000,
    )
    expect(plan).toMatchObject({ objectCount: 1, totalBytes: bytes.length })
    expect(
      JSON.stringify({ objectCount: plan.objectCount, totalBytes: plan.totalBytes }),
    ).not.toContain(userId)
    expect(() =>
      inspectWebChatStorageSnapshot(dump(row()), storageDump(storageRow()), 0, 1_000_000),
    ).toThrow(/MAX_STORAGE_OBJECTS/)
    expect(() =>
      inspectWebChatStorageSnapshot(dump(row()), storageDump(storageRow()), 10, bytes.length - 1),
    ).toThrow(/MAX_BACKUP_ARTIFACT_BYTES/)
  })

  it('uses real Storage metadata and rejects MIME, cache, size, or missing-row drift', () => {
    expect(extractWebChatStorageObjectMetadata(storageDump(storageRow())).get(objectKey)).toEqual({
      bytes: bytes.length,
      contentType: 'image/webp',
      cacheControl: '0',
    })
    expect(() =>
      extractWebChatImageReferences(
        dump(row()),
        storageDump(
          storageRow({
            metadata: JSON.stringify({
              size: bytes.length,
              contentLength: bytes.length,
              mimetype: 'image/png',
              cacheControl: '0',
            }),
          }),
        ),
      ),
    ).toThrow(/MIME type/)
    expect(() =>
      extractWebChatImageReferences(
        dump(row()),
        storageDump(
          storageRow({
            metadata: JSON.stringify({
              size: bytes.length,
              contentLength: bytes.length,
              mimetype: 'image/webp',
              cacheControl: '3600',
            }),
          }),
        ),
      ),
    ).toThrow(/Cache-Control/)
    expect(() =>
      extractWebChatImageReferences(
        dump(row()),
        storageDump(
          storageRow({
            metadata: JSON.stringify({
              size: bytes.length + 1,
              contentLength: bytes.length + 1,
              mimetype: 'image/webp',
              cacheControl: '0',
            }),
          }),
        ),
      ),
    ).toThrow(/size differs/)
    expect(() => extractWebChatImageReferences(dump(row()), storageDump())).toThrow(
      /no Storage metadata row/,
    )
  })

  it('fails closed for invalid paths, missing objects, hash drift, or configured limits', async () => {
    expect(() =>
      extractWebChatImageReferences(
        dump(row({ object_key: '../outside.webp' })),
        storageDump(storageRow()),
      ),
    ).toThrow(/object key/)

    await expect(
      stageWebChatStorageBackup({
        dataSql: dump(row()),
        storageDataSql: storageDump(storageRow()),
        metadataSource: metadata,
        downloadParent: join(root, 'missing'),
        outputDirectory: join(root, 'missing-output'),
        maxObjects: 10,
        maxBytes: 1_000_000,
      }),
    ).rejects.toThrow(/missing|regular file/)

    const downloadParent = join(root, 'download')
    const sourcePath = join(downloadParent, 'webchat-images', ...objectKey.split('/'))
    await mkdir(join(sourcePath, '..'), { recursive: true })
    await writeFile(sourcePath, Buffer.from('different-content-size'))
    await expect(
      stageWebChatStorageBackup({
        dataSql: dump(row()),
        storageDataSql: storageDump(storageRow()),
        metadataSource: metadata,
        downloadParent,
        outputDirectory: join(root, 'drift-output'),
        maxObjects: 10,
        maxBytes: 1_000_000,
      }),
    ).rejects.toThrow(/byte size|SHA-256/)

    await expect(
      stageWebChatStorageBackup({
        dataSql: dump(row()),
        storageDataSql: storageDump(storageRow()),
        metadataSource: metadata,
        downloadParent,
        outputDirectory: join(root, 'limit-output'),
        maxObjects: 0,
        maxBytes: 1_000_000,
      }),
    ).rejects.toThrow(/MAX_STORAGE_OBJECTS/)
  })
})
