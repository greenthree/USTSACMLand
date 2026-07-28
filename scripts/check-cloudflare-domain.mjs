import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PRODUCTION_ORIGIN = 'https://ustsacm.fun'
export const DEFAULT_LEGACY_URL = 'https://greenthree.github.io/USTSACMLand/'
export const MIN_FINGERPRINTED_ASSET_MAX_AGE = 31_536_000
export const MAX_HTML_MAX_AGE = 3_600

function normalizeHeaderMap(headers) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]),
  )
}

export function parseCacheControl(value) {
  const directives = new Map()
  for (const rawDirective of String(value ?? '').split(',')) {
    const directive = rawDirective.trim()
    if (!directive) continue
    const separator = directive.indexOf('=')
    if (separator === -1) {
      directives.set(directive.toLowerCase(), true)
      continue
    }
    const name = directive.slice(0, separator).trim().toLowerCase()
    const rawValue = directive
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/g, '')
    directives.set(name, /^\d+$/.test(rawValue) ? Number(rawValue) : rawValue)
  }
  return directives
}

function getHeader(response, name) {
  return normalizeHeaderMap(response?.headers)[name.toLowerCase()] ?? null
}

function cacheLifetime(response) {
  const directives = parseCacheControl(getHeader(response, 'cache-control'))
  const maxAge = directives.get('max-age')
  const sharedMaxAge = directives.get('s-maxage')
  return {
    directives,
    browserSeconds: typeof maxAge === 'number' ? maxAge : null,
    edgeSeconds: typeof sharedMaxAge === 'number' ? sharedMaxAge : null,
  }
}

function isRedirectTo(response, expectedUrl) {
  const location = getHeader(response, 'location')
  return (
    Boolean(location) &&
    [301, 302, 307, 308].includes(response?.status) &&
    new URL(location, expectedUrl).href === expectedUrl
  )
}

function isSpaDocument(response) {
  const contentType = getHeader(response, 'content-type') ?? ''
  return (
    contentType.toLowerCase().includes('text/html') &&
    /<div\s+id=["']root["'][^>]*>/i.test(response?.body ?? '') &&
    /\/assets\/[A-Za-z0-9._-]+\.js["']/i.test(response?.body ?? '')
  )
}

function checkHtmlCache(errors, label, response, requireExplicitMaxAge) {
  const lifetime = cacheLifetime(response)
  if (lifetime.directives.has('immutable')) errors.push(`${label} 不得使用 immutable。`)
  if (lifetime.browserSeconds === null) {
    if (requireExplicitMaxAge) {
      errors.push(`${label} 缺少可验证的 Cache-Control max-age。`)
    } else if (getHeader(response, 'cf-cache-status')?.toUpperCase() === 'HIT') {
      errors.push(`${label} 缺少明确短缓存头但已命中 Cloudflare 边缘缓存。`)
    }
  } else if (lifetime.browserSeconds > MAX_HTML_MAX_AGE) {
    errors.push(
      `${label} 浏览器缓存为 ${lifetime.browserSeconds} 秒，超过 ${MAX_HTML_MAX_AGE} 秒上限。`,
    )
  }
  if (lifetime.edgeSeconds !== null && lifetime.edgeSeconds > MAX_HTML_MAX_AGE) {
    errors.push(`${label} 边缘缓存为 ${lifetime.edgeSeconds} 秒，超过 ${MAX_HTML_MAX_AGE} 秒上限。`)
  }
}

export function evaluateCloudflareDomainContract(state) {
  const errors = []
  const warnings = []
  const expectedRoot = `${state.origin}/`

  if (!isRedirectTo(state.httpRoot, expectedRoot)) {
    errors.push(`HTTP 根地址必须跳转到 ${expectedRoot}。`)
  }
  if (!isRedirectTo(state.wwwRoot, expectedRoot)) {
    errors.push(`www 地址必须跳转到 ${expectedRoot}。`)
  }
  if (!isRedirectTo(state.legacyRoot, expectedRoot)) {
    errors.push(`旧 GitHub Pages 地址必须跳转到 ${expectedRoot}。`)
  }

  for (const [label, response, allowedStatuses, requireExplicitMaxAge] of [
    ['首页 HTML', state.root, [200], true],
    ['index.html', state.index, [200], true],
    ['404.html', state.fallback, [200], true],
    ['SPA 深链回退', state.deepLink, [200, 404], false],
  ]) {
    if (!allowedStatuses.includes(response?.status)) {
      errors.push(`${label} 返回 ${response?.status ?? '未知状态'}。`)
      continue
    }
    if (!isSpaDocument(response)) errors.push(`${label} 未返回可启动 React SPA 的 HTML。`)
    checkHtmlCache(errors, label, response, requireExplicitMaxAge)
  }

  if (!state.assetPath?.startsWith('/assets/')) {
    errors.push('首页未发现 /assets/ 下的指纹 JavaScript 资源。')
  }
  if (state.assetFirst?.status !== 200 || state.assetSecond?.status !== 200) {
    errors.push('指纹资源无法连续成功读取。')
  } else {
    const lifetime = cacheLifetime(state.assetSecond)
    if (lifetime.browserSeconds === null) {
      errors.push('指纹资源缺少可验证的 Cache-Control max-age。')
    } else if (lifetime.browserSeconds < MIN_FINGERPRINTED_ASSET_MAX_AGE) {
      errors.push(
        `指纹资源浏览器缓存仅 ${lifetime.browserSeconds} 秒，要求至少 ${MIN_FINGERPRINTED_ASSET_MAX_AGE} 秒。`,
      )
    }
    if (lifetime.edgeSeconds !== null && lifetime.edgeSeconds < MIN_FINGERPRINTED_ASSET_MAX_AGE) {
      errors.push(
        `指纹资源边缘缓存仅 ${lifetime.edgeSeconds} 秒，要求至少 ${MIN_FINGERPRINTED_ASSET_MAX_AGE} 秒。`,
      )
    }
    if (!lifetime.directives.has('immutable')) errors.push('指纹资源必须使用 immutable。')
    const secondCacheStatus = getHeader(state.assetSecond, 'cf-cache-status')?.toUpperCase()
    if (secondCacheStatus !== 'HIT') {
      errors.push(
        `指纹资源第二次读取必须命中 Cloudflare 边缘缓存，当前为 ${secondCacheStatus ?? '缺失'}。`,
      )
    }
  }

  const rootServer = getHeader(state.root, 'server')?.toLowerCase()
  if (rootServer !== 'cloudflare') errors.push('正式域名未确认由 Cloudflare 代理。')
  if (!getHeader(state.root, 'cf-ray'))
    warnings.push('正式首页响应缺少 CF-Ray，无法记录边缘请求证据。')

  return {
    errors,
    warnings,
    summary: {
      origin: state.origin,
      assetPath: state.assetPath ?? null,
      htmlMaxAge: cacheLifetime(state.root).browserSeconds,
      assetMaxAge: cacheLifetime(state.assetSecond).browserSeconds,
      assetCacheStatus: getHeader(state.assetSecond, 'cf-cache-status'),
      cfRay: getHeader(state.root, 'cf-ray'),
    },
  }
}

async function request(url) {
  const response = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml,application/javascript,*/*;q=0.8' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  }
}

export async function collectCloudflareDomainState({
  origin = DEFAULT_PRODUCTION_ORIGIN,
  legacyUrl = DEFAULT_LEGACY_URL,
  deepLinkPath = '/rankings',
} = {}) {
  const normalizedOrigin = new URL(origin).origin
  const root = await request(`${normalizedOrigin}/`)
  const assetPath = root.body.match(/(?:src|href)=["']([^"']*\/assets\/[^"']+\.js)["']/i)?.[1]
  const assetUrl = assetPath
    ? new URL(assetPath, normalizedOrigin).href
    : `${normalizedOrigin}/assets/`
  const host = new URL(normalizedOrigin).host

  const [httpRoot, wwwRoot, legacyRoot, index, fallback, deepLink] = await Promise.all([
    request(`http://${host}/`),
    request(`https://www.${host}/`),
    request(legacyUrl),
    request(`${normalizedOrigin}/index.html`),
    request(`${normalizedOrigin}/404.html`),
    request(new URL(deepLinkPath, `${normalizedOrigin}/`).href),
  ])
  const assetFirst = await request(assetUrl)
  const assetSecond = await request(assetUrl)

  return {
    origin: normalizedOrigin,
    assetPath,
    httpRoot,
    wwwRoot,
    legacyRoot,
    root,
    index,
    fallback,
    deepLink,
    assetFirst,
    assetSecond,
  }
}

async function main() {
  const state = await collectCloudflareDomainState()
  const result = evaluateCloudflareDomainContract(state)
  console.log(JSON.stringify(result.summary, null, 2))
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`)
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`ERROR: ${error}`)
    process.exitCode = 1
    return
  }
  console.log('Cloudflare 域名、跳转、SPA 回退与缓存契约检查通过。')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Cloudflare 域名检查失败：${error instanceof Error ? error.message : '未知错误'}。`,
    )
    process.exitCode = 1
  })
}
