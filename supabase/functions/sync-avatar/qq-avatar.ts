const MAX_QQ_AVATAR_BYTES = 1024 * 1024
const QQ_AVATAR_TIMEOUT_MS = 10_000

export class AvatarSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AvatarSourceError'
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QQ_AVATAR_BYTES) {
    throw new AvatarSourceError('QQ avatar response is too large')
  }
  if (!response.body) throw new AvatarSourceError('QQ avatar response has no body')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_QQ_AVATAR_BYTES) {
        throw new AvatarSourceError('QQ avatar response is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (total < 1) throw new AvatarSourceError('QQ avatar response is empty')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function fetchQqAvatar(
  qq: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mediaType: string | null }> {
  if (!/^\d{5,12}$/.test(qq)) throw new AvatarSourceError('QQ number is invalid')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), QQ_AVATAR_TIMEOUT_MS)
  try {
    const url = new URL('https://q1.qlogo.cn/g')
    url.searchParams.set('b', 'qq')
    url.searchParams.set('nk', qq)
    url.searchParams.set('s', '100')
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg' },
    })
    if (!response.ok) throw new AvatarSourceError('QQ avatar upstream request failed')
    return {
      bytes: await readBoundedBody(response),
      mediaType: response.headers.get('content-type')?.split(';', 1)[0]?.trim() || null,
    }
  } finally {
    clearTimeout(timeout)
  }
}
