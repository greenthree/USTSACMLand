import { evaluateCloudflareDomainContract, parseCacheControl } from './check-cloudflare-domain.mjs'

const spaHtml = `<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>`

function response(status: number, headers: Record<string, string>, body = '') {
  return { status, headers: { ...headers }, body }
}

function readyState() {
  const htmlHeaders = {
    'cache-control': 'max-age=600',
    'content-type': 'text/html; charset=utf-8',
    server: 'cloudflare',
    'cf-ray': 'test-SIN',
  }
  const assetHeaders = {
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': 'application/javascript',
    server: 'cloudflare',
    'cf-cache-status': 'HIT',
  }
  return {
    origin: 'https://ustsacm.fun',
    assetPath: '/assets/index-abc123.js',
    httpRoot: response(301, { location: 'https://ustsacm.fun/' }),
    wwwRoot: response(301, { location: 'https://ustsacm.fun/' }),
    legacyRoot: response(301, { location: 'https://ustsacm.fun/' }),
    root: response(200, htmlHeaders, spaHtml),
    index: response(200, htmlHeaders, spaHtml),
    fallback: response(200, htmlHeaders, spaHtml),
    deepLink: response(404, htmlHeaders, spaHtml),
    assetFirst: response(200, { ...assetHeaders, 'cf-cache-status': 'MISS' }),
    assetSecond: response(200, assetHeaders),
  }
}

describe('Cloudflare production-domain checker', () => {
  it('parses numeric and flag cache directives', () => {
    expect(parseCacheControl('public, max-age="31536000", immutable')).toEqual(
      new Map([
        ['public', true],
        ['max-age', 31_536_000],
        ['immutable', true],
      ]),
    )
  })

  it('accepts short-lived SPA HTML and immutable edge-cached assets', () => {
    expect(evaluateCloudflareDomainContract(readyState())).toMatchObject({
      errors: [],
      warnings: [],
      summary: {
        origin: 'https://ustsacm.fun',
        htmlMaxAge: 600,
        assetMaxAge: 31_536_000,
        assetCacheStatus: 'HIT',
      },
    })
  })

  it('accepts an uncached GitHub Pages deep-link fallback without Cache-Control', () => {
    const state = readyState()
    delete state.deepLink.headers['cache-control']
    state.deepLink.headers['cf-cache-status'] = 'DYNAMIC'

    expect(evaluateCloudflareDomainContract(state).errors).toEqual([])
  })

  it('rejects a deep-link fallback cached without an explicit short lifetime', () => {
    const state = readyState()
    delete state.deepLink.headers['cache-control']
    state.deepLink.headers['cf-cache-status'] = 'HIT'

    expect(evaluateCloudflareDomainContract(state).errors).toContain(
      'SPA 深链回退 缺少明确短缓存头但已命中 Cloudflare 边缘缓存。',
    )
  })

  it('rejects the current four-hour asset cache and dynamic edge response', () => {
    const state = readyState()
    state.assetSecond.headers['cache-control'] = 'max-age=14400'
    state.assetSecond.headers['cf-cache-status'] = 'DYNAMIC'

    expect(evaluateCloudflareDomainContract(state).errors).toEqual(
      expect.arrayContaining([
        '指纹资源浏览器缓存仅 14400 秒，要求至少 31536000 秒。',
        '指纹资源必须使用 immutable。',
        '指纹资源第二次读取必须命中 Cloudflare 边缘缓存，当前为 DYNAMIC。',
      ]),
    )
  })

  it('rejects long-lived HTML, broken redirects and a non-SPA fallback', () => {
    const state = readyState()
    state.root.headers['cache-control'] = 'public, max-age=86400, immutable'
    state.wwwRoot.headers.location = 'https://www.ustsacm.fun/'
    state.deepLink.body = '<html><body>not found</body></html>'

    expect(evaluateCloudflareDomainContract(state).errors).toEqual(
      expect.arrayContaining([
        'www 地址必须跳转到 https://ustsacm.fun/。',
        '首页 HTML 不得使用 immutable。',
        '首页 HTML 浏览器缓存为 86400 秒，超过 3600 秒上限。',
        'SPA 深链回退 未返回可启动 React SPA 的 HTML。',
      ]),
    )
  })
})
