export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 2_048
export const MAX_IMAGE_PIXELS = 4_194_304

export type SupportedImageFormat = 'jpeg' | 'png' | 'webp'

export interface InspectedImage {
  format: SupportedImageFormat
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
}

export type ImageInspectionErrorCode =
  | 'image_too_large'
  | 'unsupported_image_type'
  | 'image_type_mismatch'
  | 'invalid_image'
  | 'animated_image_not_supported'
  | 'image_dimensions_exceeded'

export class ImageInspectionError extends Error {
  constructor(
    readonly code: ImageInspectionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ImageInspectionError'
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function fail(code: ImageInspectionErrorCode, message: string): never {
  throw new ImageInspectionError(code, message)
}

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function checkedDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail('invalid_image', 'Image dimensions are invalid')
  }
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    fail(
      'image_dimensions_exceeded',
      `Image dimensions exceed ${MAX_IMAGE_DIMENSION} x ${MAX_IMAGE_DIMENSION}`,
    )
  }
  return { width, height }
}

function inspectPng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 45 || !matches(bytes, 0, PNG_SIGNATURE)) {
    fail('invalid_image', 'PNG signature is invalid')
  }

  let offset: number = PNG_SIGNATURE.length
  let chunkCount = 0
  let dimensions: { width: number; height: number } | null = null
  let sawImageData = false
  let sawEnd = false

  while (offset < bytes.byteLength) {
    chunkCount += 1
    if (chunkCount > 100_000 || offset + 12 > bytes.byteLength) {
      fail('invalid_image', 'PNG chunk structure is invalid')
    }

    const length = readUint32BigEndian(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    const dataOffset = offset + 8
    const nextOffset = dataOffset + length + 4
    if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.byteLength) {
      fail('invalid_image', 'PNG chunk exceeds the file boundary')
    }

    if (chunkCount === 1) {
      if (type !== 'IHDR' || length !== 13) {
        fail('invalid_image', 'PNG must begin with a 13-byte IHDR chunk')
      }
      dimensions = checkedDimensions(
        readUint32BigEndian(bytes, dataOffset),
        readUint32BigEndian(bytes, dataOffset + 4),
      )
    } else if (type === 'IHDR') {
      fail('invalid_image', 'PNG contains more than one IHDR chunk')
    }

    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      fail('animated_image_not_supported', 'Animated PNG images are not supported')
    }
    if (type === 'IDAT') sawImageData = true
    if (type === 'IEND') {
      if (length !== 0 || nextOffset !== bytes.byteLength) {
        fail('invalid_image', 'PNG contains an invalid IEND chunk or trailing data')
      }
      sawEnd = true
      break
    }

    offset = nextOffset
  }

  if (!dimensions || !sawImageData || !sawEnd) {
    fail('invalid_image', 'PNG is missing required image chunks')
  }
  return dimensions
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function inspectJpeg(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail('invalid_image', 'JPEG signature is invalid')
  }

  let offset = 2
  let dimensions: { width: number; height: number } | null = null
  let sawScan = false
  let sawEnd = false

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) fail('invalid_image', 'JPEG marker structure is invalid')
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.byteLength) fail('invalid_image', 'JPEG ends inside a marker')

    const marker = bytes[offset]!
    offset += 1
    if (marker === 0xd9) {
      if (offset !== bytes.byteLength) fail('invalid_image', 'JPEG contains trailing data')
      sawEnd = true
      break
    }
    if (marker === 0xda) {
      if (offset + 2 > bytes.byteLength) fail('invalid_image', 'JPEG scan header is truncated')
      const scanLength = readUint16BigEndian(bytes, offset)
      if (scanLength < 2 || offset + scanLength > bytes.byteLength) {
        fail('invalid_image', 'JPEG scan header is invalid')
      }
      offset += scanLength
      sawScan = true

      let foundNextMarker = false
      while (offset + 1 < bytes.byteLength) {
        if (bytes[offset] !== 0xff) {
          offset += 1
          continue
        }
        const markerOffset = offset
        let codeOffset = offset + 1
        while (codeOffset < bytes.byteLength && bytes[codeOffset] === 0xff) codeOffset += 1
        if (codeOffset >= bytes.byteLength) break

        const next = bytes[codeOffset]!
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset = codeOffset + 1
          continue
        }
        offset = markerOffset
        foundNextMarker = true
        break
      }
      if (!foundNextMarker) fail('invalid_image', 'JPEG scan does not terminate with a marker')
      continue
    }

    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      fail('invalid_image', 'JPEG contains an invalid standalone marker')
    }
    if (offset + 2 > bytes.byteLength) fail('invalid_image', 'JPEG segment is truncated')

    const segmentLength = readUint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      fail('invalid_image', 'JPEG segment exceeds the file boundary')
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) fail('invalid_image', 'JPEG frame header is too short')
      const nextDimensions = checkedDimensions(
        readUint16BigEndian(bytes, offset + 5),
        readUint16BigEndian(bytes, offset + 3),
      )
      if (
        dimensions &&
        (dimensions.width !== nextDimensions.width || dimensions.height !== nextDimensions.height)
      ) {
        fail('invalid_image', 'JPEG frame dimensions conflict')
      }
      dimensions = nextDimensions
    }
    offset += segmentLength
  }

  if (!dimensions || !sawScan || !sawEnd) {
    fail('invalid_image', 'JPEG is missing a frame, scan, or end marker')
  }
  return dimensions
}

function inspectWebp(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 26 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    fail('invalid_image', 'WebP signature is invalid')
  }
  if (readUint32LittleEndian(bytes, 4) + 8 !== bytes.byteLength) {
    fail('invalid_image', 'WebP RIFF length is invalid or contains trailing data')
  }

  let offset = 12
  let chunkCount = 0
  let imageDataChunks = 0
  let dimensions: { width: number; height: number } | null = null

  const setDimensions = (width: number, height: number) => {
    const next = checkedDimensions(width, height)
    if (dimensions && (dimensions.width !== next.width || dimensions.height !== next.height)) {
      fail('invalid_image', 'WebP canvas and frame dimensions conflict')
    }
    dimensions = next
  }

  while (offset < bytes.byteLength) {
    chunkCount += 1
    if (chunkCount > 100_000 || offset + 8 > bytes.byteLength) {
      fail('invalid_image', 'WebP chunk structure is invalid')
    }

    const type = ascii(bytes, offset, 4)
    const length = readUint32LittleEndian(bytes, offset + 4)
    const dataOffset = offset + 8
    const paddedLength = length + (length & 1)
    const nextOffset = dataOffset + paddedLength
    if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.byteLength) {
      fail('invalid_image', 'WebP chunk exceeds the file boundary')
    }

    if (type === 'ANIM' || type === 'ANMF') {
      fail('animated_image_not_supported', 'Animated WebP images are not supported')
    }
    if (type === 'VP8X') {
      if (length !== 10) fail('invalid_image', 'WebP extended header is invalid')
      if ((bytes[dataOffset]! & 0x02) !== 0) {
        fail('animated_image_not_supported', 'Animated WebP images are not supported')
      }
      setDimensions(
        readUint24LittleEndian(bytes, dataOffset + 4) + 1,
        readUint24LittleEndian(bytes, dataOffset + 7) + 1,
      )
    } else if (type === 'VP8 ') {
      imageDataChunks += 1
      if (
        length < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        fail('invalid_image', 'WebP VP8 frame header is invalid')
      }
      setDimensions(
        readUint16LittleEndian(bytes, dataOffset + 6) & 0x3fff,
        readUint16LittleEndian(bytes, dataOffset + 8) & 0x3fff,
      )
    } else if (type === 'VP8L') {
      imageDataChunks += 1
      if (length < 5 || bytes[dataOffset] !== 0x2f) {
        fail('invalid_image', 'WebP VP8L frame header is invalid')
      }
      const packed = readUint32LittleEndian(bytes, dataOffset + 1)
      setDimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1)
    }

    offset = nextOffset
  }

  if (offset !== bytes.byteLength || imageDataChunks !== 1 || !dimensions) {
    fail('invalid_image', 'WebP must contain exactly one image frame')
  }
  return dimensions
}

function sniffFormat(bytes: Uint8Array): SupportedImageFormat {
  if (matches(bytes, 0, PNG_SIGNATURE)) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  fail('unsupported_image_type', 'Only JPEG, PNG, and WebP images are supported')
}

function mediaType(format: SupportedImageFormat): InspectedImage['mediaType'] {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  return 'image/webp'
}

export function inspectImage(
  bytes: Uint8Array,
  declaredMediaType: string | null | undefined,
): InspectedImage {
  if (bytes.byteLength < 1) fail('invalid_image', 'Image file is empty')
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    fail('image_too_large', `Image exceeds ${MAX_IMAGE_BYTES} bytes`)
  }

  const format = sniffFormat(bytes)
  const expectedMediaType = mediaType(format)
  const normalizedDeclaredType = declaredMediaType?.trim().toLowerCase() || null
  if (
    normalizedDeclaredType &&
    !['image/jpeg', 'image/png', 'image/webp'].includes(normalizedDeclaredType)
  ) {
    fail('unsupported_image_type', 'Only JPEG, PNG, and WebP images are supported')
  }
  if (normalizedDeclaredType && normalizedDeclaredType !== expectedMediaType) {
    fail('image_type_mismatch', 'Declared image type does not match the file signature')
  }

  const dimensions =
    format === 'jpeg'
      ? inspectJpeg(bytes)
      : format === 'png'
        ? inspectPng(bytes)
        : inspectWebp(bytes)

  return { format, mediaType: expectedMediaType, ...dimensions }
}
