import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  isInsecureLoopbackOrigin,
  parsePreviewOrigin,
  rewritePreviewUrl,
} from './preview-origin.ts'

Deno.test('preview origin accepts HTTPS and explicit loopback HTTP origins', () => {
  assertEquals(parsePreviewOrigin('https://ustsacm.fun')?.origin, 'https://ustsacm.fun')
  const loopback = parsePreviewOrigin('http://127.0.0.1:54321')
  assertEquals(loopback?.origin, 'http://127.0.0.1:54321')
  assertEquals(isInsecureLoopbackOrigin(loopback!), true)
})

Deno.test('preview origin rejects external HTTP and non-origin input', () => {
  for (const value of [
    'http://example.com',
    'https://user@example.com',
    'https://example.com/path',
    'https://example.com/?query=1',
    'https://example.com/#fragment',
  ]) {
    assertThrows(() => parsePreviewOrigin(value), Error, 'preview origin is invalid')
  }
})

Deno.test('preview URL rewrite preserves only the signed path and query', () => {
  const origin = parsePreviewOrigin('http://localhost:54321')
  assertEquals(
    rewritePreviewUrl(
      'http://kong:8000/storage/v1/object/sign/webchat-images/example.webp?token=secret',
      origin,
    ),
    'http://localhost:54321/storage/v1/object/sign/webchat-images/example.webp?token=secret',
  )
})

Deno.test('preview URL rewrite rejects credentialed or fragmented signed URLs', () => {
  const origin = parsePreviewOrigin('https://ustsacm.fun')
  for (const value of [
    'https://user@example.com/storage/v1/object/sign/example',
    'https://example.com/storage/v1/object/sign/example#fragment',
    'ftp://example.com/storage/v1/object/sign/example',
    'https://example.com/not-a-storage-signature',
  ]) {
    assertThrows(() => rewritePreviewUrl(value, origin), Error, 'preview URL is invalid')
  }
})
