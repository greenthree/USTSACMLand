import { randomBytes } from 'node:crypto'
import { bundleBudget, verifyBundleBudget } from './check-bundle-size.mjs'

const entryName = 'index-test.js'
const requiredAssets = new Map(
  bundleBudget.requiredRouteChunks.map((prefix) => [`${prefix}test.js`, Buffer.from('route')]),
)

function fixture(entry: Uint8Array, assets = requiredAssets) {
  return {
    html: `<script type="module" crossorigin src="/USTSACMLand/assets/${entryName}"></script>`,
    assets: new Map([[entryName, entry], ...assets]),
  }
}

describe('production bundle budget', () => {
  it('accepts an entry within both limits when all critical routes stay split', () => {
    const result = verifyBundleBudget(fixture(Buffer.alloc(480 * 1024, 'a')))

    expect(result).toMatchObject({ entryName, entryRawBytes: 480 * 1024 })
    expect(result.entryGzipBytes).toBeLessThan(bundleBudget.entryGzipBytes)
  })

  it('rejects an oversized raw entry bundle', () => {
    expect(() => verifyBundleBudget(fixture(Buffer.alloc(bundleBudget.entryRawBytes + 1)))).toThrow(
      /limit is 500\.00 KiB/,
    )
  })

  it('rejects an entry whose compressed transfer size exceeds the gzip budget', () => {
    expect(() =>
      verifyBundleBudget(fixture(randomBytes(bundleBudget.entryGzipBytes + 1024))),
    ).toThrow(/gzip; limit is 160\.00 KiB/)
  })

  it('rejects accidental removal of a critical lazy route chunk', () => {
    const assets = new Map(requiredAssets)
    assets.delete('RankingsPage-test.js')

    expect(() => verifyBundleBudget(fixture(Buffer.alloc(100), assets))).toThrow(/RankingsPage-/)
  })

  it('rejects HTML without a production module entry', () => {
    expect(() => verifyBundleBudget({ html: '<div id="root"></div>', assets: new Map() })).toThrow(
      /does not reference a module entry script/,
    )
  })
})
