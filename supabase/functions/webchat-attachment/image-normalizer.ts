// Codec packages stay pinned inline so deployment cannot resolve a moving tag.
// deno-lint-ignore-file no-import-prefix

import jpegDecode, { init as initJpegDecode } from 'npm:@jsquash/jpeg@1.6.0/decode.js'
import pngDecode, { init as initPngDecode } from 'npm:@jsquash/png@3.1.1/decode.js'
import webpDecode, { init as initWebpDecode } from 'npm:@jsquash/webp@1.5.0/decode.js'
import webpEncode, { init as initWebpEncode } from 'npm:@jsquash/webp@1.5.0/encode.js'
import { simd } from 'npm:wasm-feature-detect@1.8.0'
import {
  type InspectedImage,
  inspectImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  type SupportedImageFormat,
} from './image-format.ts'

const OUTPUT_MEDIA_TYPE = 'image/webp' as const
const WEBP_ENCODE_OPTIONS = { quality: 82, method: 4 } as const

export type ImageNormalizationErrorCode =
  | 'image_decode_failed'
  | 'image_dimensions_mismatch'
  | 'image_encode_failed'
  | 'image_output_too_large'

const SAFE_ERROR_MESSAGES: Record<ImageNormalizationErrorCode, string> = {
  image_decode_failed: 'Image could not be decoded',
  image_dimensions_mismatch: 'Decoded image dimensions do not match the image header',
  image_encode_failed: 'Image could not be normalized',
  image_output_too_large: 'Normalized image exceeds the allowed size',
}

export class ImageNormalizationError extends Error {
  constructor(readonly code: ImageNormalizationErrorCode) {
    super(SAFE_ERROR_MESSAGES[code])
    this.name = 'ImageNormalizationError'
  }
}

export interface NormalizedImage {
  bytes: Uint8Array<ArrayBuffer>
  width: number
  height: number
  mediaType: typeof OUTPUT_MEDIA_TYPE
  sha256: string
}

interface DecodedImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface ImageCodecRuntime {
  decode(format: SupportedImageFormat, bytes: ArrayBuffer): Promise<DecodedImage>
  encodeWebp(image: DecodedImage, options: typeof WEBP_ENCODE_OPTIONS): Promise<ArrayBuffer>
}

export type ImageCodecLoader = () => Promise<ImageCodecRuntime>
export type ImageNormalizer = (
  bytes: Uint8Array,
  declaredMediaType: string | null | undefined,
) => Promise<NormalizedImage>

type WasmInitializer = (module: WebAssembly.Module) => Promise<unknown>

function fail(code: ImageNormalizationErrorCode): never {
  throw new ImageNormalizationError(code)
}

async function compileModule(specifier: string): Promise<WebAssembly.Module> {
  const resolved = new URL(import.meta.resolve(specifier))
  return WebAssembly.compile(await Deno.readFile(resolved))
}

async function loadDefaultCodecs(): Promise<ImageCodecRuntime> {
  const hasSimd = await simd()
  const webpEncoderWasm = hasSimd
    ? 'npm:@jsquash/webp@1.5.0/codec/enc/webp_enc_simd.wasm'
    : 'npm:@jsquash/webp@1.5.0/codec/enc/webp_enc.wasm'

  const [jpegDecoder, pngCodec, webpDecoder, webpEncoder] = await Promise.all([
    compileModule('npm:@jsquash/jpeg@1.6.0/codec/dec/mozjpeg_dec.wasm'),
    compileModule('npm:@jsquash/png@3.1.1/codec/pkg/squoosh_png_bg.wasm'),
    compileModule('npm:@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm'),
    compileModule(webpEncoderWasm),
  ])

  await Promise.all([
    (initJpegDecode as unknown as WasmInitializer)(jpegDecoder),
    (initPngDecode as unknown as WasmInitializer)(pngCodec),
    (initWebpDecode as unknown as WasmInitializer)(webpDecoder),
    (initWebpEncode as unknown as WasmInitializer)(webpEncoder),
  ])

  return {
    async decode(format, bytes) {
      const image =
        format === 'jpeg'
          ? await jpegDecode(bytes, { preserveOrientation: true })
          : format === 'png'
            ? await pngDecode(bytes)
            : await webpDecode(bytes)
      return {
        data: image.data as Uint8ClampedArray,
        width: image.width,
        height: image.height,
      }
    },
    async encodeWebp(image, options) {
      return await webpEncode(image as ImageData, options)
    },
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

function hasValidDecodedPixels(image: DecodedImage): boolean {
  if (!(image.data instanceof Uint8ClampedArray)) return false
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)) return false
  if (image.width < 1 || image.height < 1) return false
  const pixels = image.width * image.height
  if (!Number.isSafeInteger(pixels)) return false
  return image.data.byteLength === pixels * 4
}

function dimensionsWithinLimits(image: DecodedImage): boolean {
  return (
    image.width <= MAX_IMAGE_DIMENSION &&
    image.height <= MAX_IMAGE_DIMENSION &&
    image.width * image.height <= MAX_IMAGE_PIXELS
  )
}

function dimensionsMatchHeader(image: DecodedImage, inspected: InspectedImage): boolean {
  if (image.width === inspected.width && image.height === inspected.height) {
    return true
  }
  return (
    inspected.format === 'jpeg' &&
    image.width === inspected.height &&
    image.height === inspected.width
  )
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', exactArrayBuffer(bytes))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function createImageNormalizer(
  loadCodecs: ImageCodecLoader = loadDefaultCodecs,
): ImageNormalizer {
  let codecsPromise: Promise<ImageCodecRuntime> | null = null

  return async (bytes, declaredMediaType) => {
    const inspected = inspectImage(bytes, declaredMediaType)

    let decoded: DecodedImage
    try {
      codecsPromise ??= loadCodecs()
      const codecs = await codecsPromise
      decoded = await codecs.decode(inspected.format, exactArrayBuffer(bytes))
    } catch {
      fail('image_decode_failed')
    }

    if (!hasValidDecodedPixels(decoded)) fail('image_decode_failed')
    if (!dimensionsWithinLimits(decoded) || !dimensionsMatchHeader(decoded, inspected)) {
      fail('image_dimensions_mismatch')
    }

    let outputBuffer: ArrayBuffer
    try {
      const codecs = await codecsPromise
      outputBuffer = await codecs.encodeWebp(decoded, WEBP_ENCODE_OPTIONS)
    } catch {
      fail('image_encode_failed')
    }

    if (outputBuffer.byteLength < 1) fail('image_encode_failed')
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
      fail('image_output_too_large')
    }

    const outputBytes = new Uint8Array(outputBuffer)
    let outputInspection: InspectedImage
    try {
      outputInspection = inspectImage(outputBytes, OUTPUT_MEDIA_TYPE)
    } catch {
      fail('image_encode_failed')
    }
    if (outputInspection.width !== decoded.width || outputInspection.height !== decoded.height) {
      fail('image_dimensions_mismatch')
    }

    return {
      bytes: outputBytes,
      width: decoded.width,
      height: decoded.height,
      mediaType: OUTPUT_MEDIA_TYPE,
      sha256: await sha256Hex(outputBytes),
    }
  }
}

export const normalizeImage = createImageNormalizer()
