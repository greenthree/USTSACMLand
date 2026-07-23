import { strictEqual, throws } from 'node:assert/strict'
import {
  ImageInspectionError,
  inspectImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
} from './image-format.ts'

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength, false)
  chunk.set(new TextEncoder().encode(type), 4)
  chunk.set(data, 8)
  return chunk
}

function png(width = 2, height = 3, extraChunks: Uint8Array[] = []): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width, false)
  headerView.setUint32(4, height, false)
  header[8] = 8
  header[9] = 6
  const chunks = [pngChunk('IHDR', header), ...extraChunks, pngChunk('IDAT', Uint8Array.of(0))]
  chunks.push(pngChunk('IEND', new Uint8Array()))
  const result = new Uint8Array(
    signature.byteLength + chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  )
  result.set(signature)
  let offset = signature.byteLength
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function jpeg(width = 2, height = 3): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x00,
    0xff,
    0xd9,
  ])
}

function progressiveJpeg(): Uint8Array {
  const base = jpeg()
  return Uint8Array.from([
    ...base.subarray(0, base.byteLength - 2),
    0xff,
    0xd0,
    0xff,
    0xc4,
    0x00,
    0x02,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0xff,
    0x00,
    0xff,
    0xff,
    0xd9,
  ])
}

function webpLossless(width = 2, height = 3, chunks: Uint8Array[] = []): Uint8Array {
  const packed = (width - 1) | ((height - 1) << 14)
  const frame = Uint8Array.of(
    0x2f,
    packed & 0xff,
    (packed >>> 8) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 24) & 0xff,
  )
  const frameChunk = webpChunk('VP8L', frame)
  const bodyLength =
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0) + frameChunk.length
  const result = new Uint8Array(12 + bodyLength)
  result.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(result.buffer).setUint32(4, result.byteLength - 8, true)
  result.set(new TextEncoder().encode('WEBP'), 8)
  let offset = 12
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  result.set(frameChunk, offset)
  return result
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const paddedLength = data.byteLength + (data.byteLength & 1)
  const chunk = new Uint8Array(8 + paddedLength)
  chunk.set(new TextEncoder().encode(type), 0)
  new DataView(chunk.buffer).setUint32(4, data.byteLength, true)
  chunk.set(data, 8)
  return chunk
}

function expectCode(run: () => unknown, code: ImageInspectionError['code']): void {
  throws(run, (error: unknown) => {
    strictEqual(error instanceof ImageInspectionError, true)
    strictEqual((error as ImageInspectionError).code, code)
    return true
  })
}

Deno.test('inspects JPEG, PNG, and WebP signatures and dimensions', () => {
  strictEqual(inspectImage(jpeg(), 'image/jpeg').format, 'jpeg')
  strictEqual(inspectImage(progressiveJpeg(), 'image/jpeg').height, 3)
  strictEqual(inspectImage(png(), 'image/png').width, 2)
  strictEqual(inspectImage(webpLossless(), 'image/webp').height, 3)
})

Deno.test('rejects MIME mismatches and unsupported signatures', () => {
  expectCode(() => inspectImage(png(), 'image/jpeg'), 'image_type_mismatch')
  expectCode(() => inspectImage(png(), 'image/gif'), 'unsupported_image_type')
  expectCode(() => inspectImage(Uint8Array.of(1, 2, 3), null), 'unsupported_image_type')
})

Deno.test('rejects APNG and animated WebP markers before decoding', () => {
  expectCode(
    () => inspectImage(png(2, 3, [pngChunk('acTL', new Uint8Array(8))]), 'image/png'),
    'animated_image_not_supported',
  )
  expectCode(
    () => inspectImage(webpLossless(2, 3, [webpChunk('ANIM', new Uint8Array(6))]), 'image/webp'),
    'animated_image_not_supported',
  )
})

Deno.test('rejects oversized dimensions, byte size, and trailing container data', () => {
  expectCode(
    () => inspectImage(png(MAX_IMAGE_DIMENSION + 1, 1), 'image/png'),
    'image_dimensions_exceeded',
  )
  expectCode(() => inspectImage(new Uint8Array(MAX_IMAGE_BYTES + 1), null), 'image_too_large')

  const trailingPng = new Uint8Array(png().byteLength + 1)
  trailingPng.set(png())
  expectCode(() => inspectImage(trailingPng, 'image/png'), 'invalid_image')

  const trailingJpeg = new Uint8Array(jpeg().byteLength + 1)
  trailingJpeg.set(jpeg())
  expectCode(() => inspectImage(trailingJpeg, 'image/jpeg'), 'invalid_image')

  const invalidRiff = webpLossless()
  new DataView(invalidRiff.buffer).setUint32(4, invalidRiff.byteLength - 9, true)
  expectCode(() => inspectImage(invalidRiff, 'image/webp'), 'invalid_image')
})

Deno.test('accepts absent MIME but never trusts an incorrect declared type', () => {
  strictEqual(inspectImage(png(), '').mediaType, 'image/png')
  strictEqual(inspectImage(jpeg(), null).mediaType, 'image/jpeg')
})
