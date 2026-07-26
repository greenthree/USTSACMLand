const INVALID_PREVIEW_ORIGIN = 'WebChat image preview origin is invalid'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function isInsecureLoopbackOrigin(url: URL): boolean {
  return url.protocol === 'http:' && isLoopbackHost(url.hostname)
}

export function parsePreviewOrigin(value: string | null | undefined): URL | null {
  const raw = value?.trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(INVALID_PREVIEW_ORIGIN)
  }

  if (
    (url.protocol !== 'https:' && !isInsecureLoopbackOrigin(url)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(INVALID_PREVIEW_ORIGIN)
  }
  return url
}

export function rewritePreviewUrl(value: string, origin: URL | null): string {
  if (!origin) return value

  let signedUrl: URL
  try {
    signedUrl = new URL(value)
  } catch {
    throw new Error('WebChat image preview URL is invalid')
  }
  if (
    (signedUrl.protocol !== 'https:' && signedUrl.protocol !== 'http:') ||
    signedUrl.username ||
    signedUrl.password ||
    signedUrl.hash ||
    !signedUrl.pathname.startsWith('/storage/v1/object/sign/')
  ) {
    throw new Error('WebChat image preview URL is invalid')
  }
  return new URL(`${signedUrl.pathname}${signedUrl.search}`, origin).toString()
}
