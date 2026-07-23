// deno-lint-ignore-file require-await

import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import { inspectImage, MAX_IMAGE_BYTES } from './image-format.ts'
import {
  createImageNormalizer,
  type ImageCodecRuntime,
  ImageNormalizationError,
  type ImageNormalizationErrorCode,
  normalizeImage,
} from './image-normalizer.ts'

const JPEG_FIXTURE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAMDAwMDAwQEBAQFBQUFBQcHBgYHBwsICQgJCAsRCwwLCwwLEQ8SDw4PEg8bFRMTFRsfGhkaHyYiIiYwLTA+PlQBAwMDAwMDBAQEBAUFBQUFBwcGBgcHCwgJCAkICxELDAsLDAsRDxIPDg8SDxsVExMVGx8aGRofJiIiJjAtMD4+VP/CABEIAAIAAwMBEQACEQEDEQH/xAAnAAEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAAHCP/aAAwDAQACEAMQAAAAVVqQP//EABwQAAICAgMAAAAAAAAAAAAAAAECAwQFBgAyQf/aAAgBAQABPwBtF0i7cyMtnWsNO65O/EHkowuQkNh440BK9UVQqjwc/8QAHREAAgMAAgMAAAAAAAAAAAAAAgMBBAUGBwBBQv/aAAgBAgEBPwDrPa2c3rbhiaWjbrKLjeU4gS41jLbFYGtOYH6Mykin3Pn/xAAcEQACAgIDAAAAAAAAAAAAAAACAwQFAUIABwj/2gAIAQMBAT8A9JX97VdyX6IFpOiKONUyDWh5qEnSq9D3Mzgd2MPJmWxc/9k='
const PNG_FIXTURE =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAJUlEQVR4AQEaAOX/AP8AAP8A/wD/AAD//wD//wD//wD/gAD///+n9A5z5d6sugAAAABJRU5ErkJggg=='
const WEBP_FIXTURE =
  'UklGRpoAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAA/////4D/AFZQOCBsAAAAUAQAnQEqAwACAADAEiWoAnS6AfgB+oFKA/ACtAP4BlAH6ADnVTqxTi77AAD+4pVX2n/ELe6//sAKEByNvhrYZf3f4s8O0kvut/8TWxOhwt/z8PDpnVd/+90//3gLi/CGOl3/pV5jHj/+mLAA'
const SAFE_MESSAGES: Record<ImageNormalizationErrorCode, string> = {
  image_decode_failed: 'Image could not be decoded',
  image_dimensions_mismatch: 'Decoded image dimensions do not match the image header',
  image_encode_failed: 'Image could not be normalized',
  image_output_too_large: 'Normalized image exceeds the allowed size',
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const segment = new Uint8Array(payload.byteLength + 4)
  segment[0] = 0xff
  segment[1] = marker
  new DataView(segment.buffer).setUint16(2, payload.byteLength + 2, false)
  segment.set(payload, 4)
  return segment
}

function jpegWithOrientationAndTrailingMetadata(): Uint8Array {
  const jpeg = fromBase64(JPEG_FIXTURE)
  const exif = Uint8Array.from([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ])
  const comment = new TextEncoder().encode('USTSACM_TRAILING_METADATA_MUST_DISAPPEAR')
  return concat(
    jpeg.subarray(0, 2),
    jpegSegment(0xe1, exif),
    jpeg.subarray(2, jpeg.byteLength - 2),
    jpegSegment(0xfe, comment),
    jpeg.subarray(jpeg.byteLength - 2),
  )
}

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const expected = new TextEncoder().encode(value)
  outer: for (let offset = 0; offset + expected.byteLength <= bytes.byteLength; offset += 1) {
    for (let index = 0; index < expected.byteLength; index += 1) {
      if (bytes[offset + index] !== expected[index]) continue outer
    }
    return true
  }
  return false
}

function corruptPngImageData(): Uint8Array {
  const png = fromBase64(PNG_FIXTURE)
  const corrupted = png.slice()
  let offset = 8
  while (offset + 12 <= corrupted.byteLength) {
    const length = new DataView(corrupted.buffer).getUint32(offset, false)
    const type = new TextDecoder().decode(corrupted.subarray(offset + 4, offset + 8))
    if (type === 'IDAT') {
      corrupted[offset + 8] ^= 0xff
      return corrupted
    }
    offset += 12 + length
  }
  throw new Error('PNG fixture has no IDAT chunk')
}

function pixels(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(127)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function expectNormalizationCode(
  run: () => Promise<unknown>,
  code: ImageNormalizationErrorCode,
): Promise<void> {
  await rejects(run, (error: unknown) => {
    strictEqual(error instanceof ImageNormalizationError, true)
    strictEqual((error as ImageNormalizationError).code, code)
    strictEqual((error as Error).message, SAFE_MESSAGES[code])
    return true
  })
}

Deno.test('normalizes real JPEG, PNG, and WebP inputs to canonical WebP bytes', async () => {
  const fixtures = [
    { bytes: fromBase64(JPEG_FIXTURE), mediaType: 'image/jpeg' },
    { bytes: fromBase64(PNG_FIXTURE), mediaType: 'image/png' },
    { bytes: fromBase64(WEBP_FIXTURE), mediaType: 'image/webp' },
  ]

  for (const fixture of fixtures) {
    const normalized = await normalizeImage(fixture.bytes, fixture.mediaType)
    const inspected = inspectImage(normalized.bytes, 'image/webp')
    strictEqual(normalized.mediaType, 'image/webp')
    strictEqual(normalized.width, 3)
    strictEqual(normalized.height, 2)
    strictEqual(inspected.width, normalized.width)
    strictEqual(inspected.height, normalized.height)
    strictEqual(normalized.sha256, await sha256Hex(normalized.bytes))
    strictEqual(normalized.bytes.byteLength > 0, true)
  }
})

Deno.test('applies JPEG EXIF orientation and strips EXIF plus late metadata segments', async () => {
  const source = jpegWithOrientationAndTrailingMetadata()
  strictEqual(inspectImage(source, 'image/jpeg').width, 3)

  const normalized = await normalizeImage(source, 'image/jpeg')

  strictEqual(normalized.width, 2)
  strictEqual(normalized.height, 3)
  strictEqual(containsAscii(normalized.bytes, 'Exif'), false)
  strictEqual(containsAscii(normalized.bytes, 'USTSACM_TRAILING_METADATA_MUST_DISAPPEAR'), false)
})

Deno.test('maps structurally valid but undecodable input to a fixed safe error', async () => {
  const corrupted = corruptPngImageData()
  strictEqual(inspectImage(corrupted, 'image/png').format, 'png')
  await expectNormalizationCode(() => normalizeImage(corrupted, 'image/png'), 'image_decode_failed')
})

Deno.test('rechecks decoded dimensions against the inspected container', async () => {
  const mismatchRuntime: ImageCodecRuntime = {
    async decode() {
      return { data: pixels(4, 2), width: 4, height: 2 }
    },
    async encodeWebp() {
      throw new Error('must not encode a dimension mismatch')
    },
  }
  const normalizeMismatch = createImageNormalizer(async () => mismatchRuntime)
  await expectNormalizationCode(
    () => normalizeMismatch(fromBase64(PNG_FIXTURE), 'image/png'),
    'image_dimensions_mismatch',
  )

  const oversizedRuntime: ImageCodecRuntime = {
    async decode() {
      return { data: pixels(2_049, 1), width: 2_049, height: 1 }
    },
    async encodeWebp() {
      throw new Error('must not encode dimensions above the decoded-image limit')
    },
  }
  const normalizeOversized = createImageNormalizer(async () => oversizedRuntime)
  await expectNormalizationCode(
    () => normalizeOversized(fromBase64(PNG_FIXTURE), 'image/png'),
    'image_dimensions_mismatch',
  )
})

Deno.test('loads codecs once and always requests WebP quality 82 with method 4', async () => {
  let loadCount = 0
  const options: Array<{ quality: number; method: number }> = []
  const runtime: ImageCodecRuntime = {
    async decode() {
      return { data: pixels(3, 2), width: 3, height: 2 }
    },
    async encodeWebp(_image, nextOptions) {
      options.push(nextOptions)
      return fromBase64(WEBP_FIXTURE).slice().buffer
    },
  }
  const normalize = createImageNormalizer(async () => {
    loadCount += 1
    return runtime
  })

  await Promise.all([
    normalize(fromBase64(PNG_FIXTURE), 'image/png'),
    normalize(fromBase64(PNG_FIXTURE), 'image/png'),
  ])

  strictEqual(loadCount, 1)
  deepStrictEqual(options, [
    { quality: 82, method: 4 },
    { quality: 82, method: 4 },
  ])
})

Deno.test('maps empty and oversized encoder output to stable errors', async () => {
  const runtime = (output: Uint8Array): ImageCodecRuntime => ({
    async decode() {
      return { data: pixels(3, 2), width: 3, height: 2 }
    },
    async encodeWebp() {
      return output.slice().buffer
    },
  })

  await expectNormalizationCode(
    () =>
      createImageNormalizer(async () => runtime(new Uint8Array()))(
        fromBase64(PNG_FIXTURE),
        'image/png',
      ),
    'image_encode_failed',
  )
  await expectNormalizationCode(
    () =>
      createImageNormalizer(async () => runtime(new Uint8Array(MAX_IMAGE_BYTES + 1)))(
        fromBase64(PNG_FIXTURE),
        'image/png',
      ),
    'image_output_too_large',
  )
})
