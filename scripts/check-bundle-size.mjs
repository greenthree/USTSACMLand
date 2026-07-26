import { readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const bundleBudget = {
  entryRawBytes: 280 * 1024,
  entryGzipBytes: 96 * 1024,
  entryCssRawBytes: 128 * 1024,
  entryCssGzipBytes: 28 * 1024,
  requiredRouteChunks: [
    'HomePage-',
    'DailyProblemPage-',
    'RankingsPage-',
    'LoginPage-',
    'AccountPage-',
    'AssistantPage-',
    'AdminOverviewPage-',
    'AdminDailyProblemsPage-',
    'AdminSyncPage-',
  ],
}

const CHAT_VALUE_IMPORT_PATTERN = /(?:from\s*|import\s*)["'](?:@assistant-ui\/[^"']+|ai)["']/

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
    }),
  )
  return files.flat()
}

export async function verifyChatImportBoundary(sourceDirectory = join(process.cwd(), 'src')) {
  const files = await sourceFiles(sourceDirectory)
  const violations = []

  for (const file of files) {
    const normalized = file.replaceAll('\\', '/')
    if (normalized.includes('/features/chat/')) continue
    const source = await readFile(file, 'utf8')
    if (CHAT_VALUE_IMPORT_PATTERN.test(source)) violations.push(normalized)
  }

  if (violations.length > 0) {
    throw new Error(
      `Chat runtime dependencies escaped the lazy feature boundary: ${violations.join(', ')}`,
    )
  }
}

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

function entryAssetName(html) {
  const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+\.js)["']/i)
  if (!match) throw new Error('Production HTML does not reference a module entry script.')
  return basename(new URL(match[1], 'https://bundle.local/').pathname)
}

function entryCssName(html) {
  const match = html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+\.css)["']/i)
  if (!match) return null
  return basename(new URL(match[1], 'https://bundle.local/').pathname)
}

export function verifyBundleBudget({ html, assets, budget = bundleBudget }) {
  const entryName = entryAssetName(html)
  const entry = assets.get(entryName)
  if (!entry) throw new Error(`Production entry asset is missing: ${entryName}`)

  const entryRawBytes = entry.byteLength
  const entryGzipBytes = gzipSync(entry).byteLength
  if (entryRawBytes > budget.entryRawBytes) {
    throw new Error(
      `Production entry ${entryName} is ${formatKib(entryRawBytes)}; limit is ${formatKib(budget.entryRawBytes)}. Keep route modules lazy-loaded.`,
    )
  }
  if (entryGzipBytes > budget.entryGzipBytes) {
    throw new Error(
      `Production entry ${entryName} is ${formatKib(entryGzipBytes)} gzip; limit is ${formatKib(budget.entryGzipBytes)}.`,
    )
  }

  const assetNames = [...assets.keys()]
  const missingRouteChunks = budget.requiredRouteChunks.filter(
    (prefix) => !assetNames.some((name) => name.startsWith(prefix) && name.endsWith('.js')),
  )
  if (missingRouteChunks.length > 0) {
    throw new Error(
      `Production build is missing lazy route chunks: ${missingRouteChunks.join(', ')}. Check for accidental static page imports.`,
    )
  }

  let entryCssRawBytes = null
  let entryCssGzipBytes = null
  const cssName = entryCssName(html)
  if (cssName) {
    const entryCss = assets.get(cssName)
    if (!entryCss) throw new Error(`Production entry stylesheet is missing: ${cssName}`)
    entryCssRawBytes = entryCss.byteLength
    entryCssGzipBytes = gzipSync(entryCss).byteLength
    if (entryCssRawBytes > budget.entryCssRawBytes) {
      throw new Error(
        `Production entry stylesheet ${cssName} is ${formatKib(entryCssRawBytes)}; limit is ${formatKib(budget.entryCssRawBytes)}. Keep feature styles in lazily imported CSS files.`,
      )
    }
    if (entryCssGzipBytes > budget.entryCssGzipBytes) {
      throw new Error(
        `Production entry stylesheet ${cssName} is ${formatKib(entryCssGzipBytes)} gzip; limit is ${formatKib(budget.entryCssGzipBytes)}.`,
      )
    }
  }

  return { entryName, entryRawBytes, entryGzipBytes, entryCssRawBytes, entryCssGzipBytes }
}

async function readAssets(assetsDirectory) {
  const names = await readdir(assetsDirectory)
  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
      .map(async (name) => [name, await readFile(join(assetsDirectory, name))]),
  )
  return new Map(entries)
}

async function main() {
  const distDirectory = join(process.cwd(), 'dist')
  const [html, assets] = await Promise.all([
    readFile(join(distDirectory, 'index.html'), 'utf8'),
    readAssets(join(distDirectory, 'assets')),
  ])
  await verifyChatImportBoundary()
  const report = verifyBundleBudget({ html, assets })
  const cssReport =
    report.entryCssRawBytes === null
      ? ''
      : `; entry CSS ${formatKib(report.entryCssRawBytes)} raw / ${formatKib(report.entryCssGzipBytes)} gzip`
  console.log(
    `Verified production bundle budget: ${report.entryName} ${formatKib(report.entryRawBytes)} raw / ${formatKib(report.entryGzipBytes)} gzip${cssReport}.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
