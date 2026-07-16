import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  buildMembers,
  calculateBenchmarks,
  calculateOverallRating,
  calculateTotalSolved,
  expectedRows,
  formatDecimal,
  formatInteger,
  platforms,
  ratingPlatforms,
  solvedPlatforms,
  type ExpectedRankingRow,
  type Platform,
  type PublicMemberRow,
  type PublicStatRow,
} from '../scripts/production-ranking-oracle'

const pageSize = 100
const restPageSize = 1000

interface PublicAccountRow {
  profile_id: string
  platform: Platform
  external_id: string
}

interface RenderedRankingRow {
  id: string | null
  name: string | null
  primaryValue: string | null
  secondaryValue: string | null
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the read-only production audit.`)
  return value
}

const supabaseUrl = requireEnvironment('VITE_SUPABASE_URL').replace(/\/$/, '')
const supabaseAnonKey = requireEnvironment('VITE_SUPABASE_ANON_KEY')
const supabaseOrigin = new URL(supabaseUrl).origin

if (!/^https:\/\/[^/]+\.supabase\.co$/.test(supabaseUrl)) {
  throw new Error('VITE_SUPABASE_URL must be an HTTPS Supabase project URL.')
}

async function readPublicView<T>(
  request: APIRequestContext,
  view: string,
  columns: string,
  order: string,
): Promise<T[]> {
  const rows: T[] = []

  for (let offset = 0; ; offset += restPageSize) {
    const response = await request.get(
      `${supabaseUrl}/rest/v1/${view}?select=${encodeURIComponent(columns)}&order=${encodeURIComponent(order)}`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          Prefer: 'count=exact',
          Range: `${offset}-${offset + restPageSize - 1}`,
        },
      },
    )

    if (!response.ok()) {
      throw new Error(`${view} returned HTTP ${response.status()} during the read-only audit.`)
    }

    const currentRows = (await response.json()) as T[]
    rows.push(...currentRows)
    const total = Number(response.headers()['content-range']?.split('/')[1])
    if (currentRows.length < restPageSize || (Number.isFinite(total) && rows.length >= total)) break
  }

  return rows
}

function assertPublicDataIntegrity(
  memberRows: PublicMemberRow[],
  accountRows: PublicAccountRow[],
  statRows: PublicStatRow[],
) {
  const memberIds = new Set<string>()
  for (const member of memberRows) {
    expect(memberIds.has(member.id), `duplicate public member ${member.id}`).toBe(false)
    memberIds.add(member.id)
  }

  const accountKeys = new Set<string>()
  for (const account of accountRows) {
    expect(
      memberIds.has(account.profile_id),
      'public account should reference a public member',
    ).toBe(true)
    expect(
      platforms.includes(account.platform),
      'public account platform should be supported',
    ).toBe(true)
    const key = `${account.profile_id}:${account.platform}`
    expect(accountKeys.has(key), `duplicate public account ${key}`).toBe(false)
    accountKeys.add(key)
  }

  const statKeys = new Set<string>()
  for (const stat of statRows) {
    expect(
      memberIds.has(stat.profile_id),
      'public statistic should reference a public member',
    ).toBe(true)
    expect(platforms.includes(stat.platform), 'public statistic platform should be supported').toBe(
      true,
    )
    const key = `${stat.profile_id}:${stat.platform}`
    expect(accountKeys.has(key), 'public statistic should have a verified public account').toBe(
      true,
    )
    expect(statKeys.has(key), `duplicate public statistic ${key}`).toBe(false)
    statKeys.add(key)
  }
}

async function configureLargestPageSize(page: Page, memberCount: number) {
  if (memberCount <= 25) return
  await page.getByLabel('每页显示人数').selectOption(String(pageSize))
}

async function readRenderedRows(
  page: Page,
  primaryLabel: string,
  secondaryLabel?: string,
): Promise<RenderedRankingRow[]> {
  return page.locator('#ranking-results-panel tbody').evaluate(
    (tbody, labels) =>
      Array.from(tbody.querySelectorAll('tr')).map((row) => {
        const memberLink = row.querySelector<HTMLAnchorElement>('[data-label="成员"] a')
        const href = memberLink?.getAttribute('href') ?? ''
        const readCell = (label: string) => {
          const cell = row.querySelector(`[data-label="${label}"]`)
          return (
            cell?.querySelector('.rating-display-number')?.textContent?.trim() ??
            cell?.textContent?.trim() ??
            null
          )
        }
        return {
          id: /\/members\/([^/?#]+)/.exec(href)?.[1] ?? null,
          name: row.querySelector('[data-label="成员"] strong')?.textContent?.trim() ?? null,
          primaryValue: readCell(labels.primary),
          secondaryValue: labels.secondary ? readCell(labels.secondary) : null,
        }
      }),
    { primary: primaryLabel, secondary: secondaryLabel },
  )
}

async function expectAllRankingPages(
  page: Page,
  rows: ExpectedRankingRow[],
  primaryLabel: string,
  secondaryLabel?: string,
) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))

  for (let currentPage = 1; currentPage <= pages; currentPage += 1) {
    const start = (currentPage - 1) * pageSize
    const expectedPage = rows.slice(start, start + pageSize)
    await expect(
      page.getByText(`共 ${rows.length} 名 · 第 ${currentPage} / ${pages} 页`),
    ).toBeVisible()
    expect(await readRenderedRows(page, primaryLabel, secondaryLabel)).toEqual(
      expectedPage.map((row) => ({
        id: row.id,
        name: row.name,
        primaryValue: row.primaryValue,
        secondaryValue: row.secondaryValue ?? null,
      })),
    )

    if (currentPage < pages) {
      await page.getByRole('button', { name: '下一页', exact: true }).click()
    }
  }
}

test('production public views satisfy the independent ranking data contract', async ({
  request,
}) => {
  const [memberRows, accountRows, statRows] = await Promise.all([
    readPublicView<PublicMemberRow>(
      request,
      'public_members',
      'id,full_name,major,grade',
      'id.asc',
    ),
    readPublicView<PublicAccountRow>(
      request,
      'public_platform_accounts',
      'profile_id,platform,external_id',
      'profile_id.asc,platform.asc',
    ),
    readPublicView<PublicStatRow>(
      request,
      'public_platform_stats',
      'profile_id,platform,current_rating,max_rating,solved_count',
      'profile_id.asc,platform.asc',
    ),
  ])

  expect(memberRows.length, 'production should expose at least one public member').toBeGreaterThan(
    0,
  )
  expect(statRows.length, 'production should expose at least one public statistic').toBeGreaterThan(
    0,
  )
  assertPublicDataIntegrity(memberRows, accountRows, statRows)

  const members = buildMembers(memberRows, statRows)
  const currentBenchmarks = calculateBenchmarks(members, 'currentRating')
  expect(
    members.some(
      (member) => calculateOverallRating(member, currentBenchmarks, 'currentRating') !== null,
    ),
    'production should expose at least one calculable Rating total',
  ).toBeTruthy()
  expect(
    members.some((member) => calculateTotalSolved(member) !== null),
    'production should expose at least one calculable solved total',
  ).toBe(true)
})

test('production rankings match independent paginated reads of every public ranking', async ({
  page,
  request,
}) => {
  const observedViews = new Set<string>()
  const failedPublicResponses: Array<{ path: string; status: number }> = []
  const forbiddenMethods: string[] = []

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const method = route.request().method()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      forbiddenMethods.push(method)
      await route.abort()
      return
    }
    await route.continue()
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin !== supabaseOrigin || !url.pathname.startsWith('/rest/v1/public_')) return
    observedViews.add(url.pathname.slice('/rest/v1/'.length))
    if (!response.ok())
      failedPublicResponses.push({ path: url.pathname, status: response.status() })
  })

  await page.goto('rankings')
  await expect(page).toHaveTitle('榜单 | USTS ACM Land')
  await expect(page.getByText('数据更新于最新成功同步', { exact: true })).toBeVisible()
  await expect(page.getByText('演示数据', { exact: true })).toHaveCount(0)
  await expect(page.getByText('实时数据读取失败，当前显示演示数据。', { exact: true })).toHaveCount(
    0,
  )

  const [memberRows, accountRows, statRows] = await Promise.all([
    readPublicView<PublicMemberRow>(
      request,
      'public_members',
      'id,full_name,major,grade',
      'id.asc',
    ),
    readPublicView<PublicAccountRow>(
      request,
      'public_platform_accounts',
      'profile_id,platform,external_id',
      'profile_id.asc,platform.asc',
    ),
    readPublicView<PublicStatRow>(
      request,
      'public_platform_stats',
      'profile_id,platform,current_rating,max_rating,solved_count',
      'profile_id.asc,platform.asc',
    ),
  ])

  expect(memberRows.length, 'production should expose at least one public member').toBeGreaterThan(
    0,
  )
  expect(statRows.length, 'production should expose at least one public statistic').toBeGreaterThan(
    0,
  )
  assertPublicDataIntegrity(memberRows, accountRows, statRows)

  const members = buildMembers(memberRows, statRows)
  const currentBenchmarks = calculateBenchmarks(members, 'currentRating')
  const peakBenchmarks = calculateBenchmarks(members, 'maxRating')
  expect(
    members.some(
      (member) => calculateOverallRating(member, currentBenchmarks, 'currentRating') !== null,
    ),
    'production should expose at least one calculable Rating total',
  ).toBeTruthy()
  expect(
    members.some((member) => calculateTotalSolved(member) !== null),
    'production should expose at least one calculable solved total',
  ).toBe(true)

  await configureLargestPageSize(page, members.length)
  await expectAllRankingPages(
    page,
    expectedRows(
      members,
      (member) => calculateOverallRating(member, currentBenchmarks, 'currentRating'),
      formatDecimal,
      (member) => calculateOverallRating(member, peakBenchmarks, 'maxRating'),
    ),
    '总 Rating',
    '总历史最高 Rating',
  )

  for (const platform of ratingPlatforms) {
    await page
      .getByRole('tab', {
        name:
          platform === 'nowcoder'
            ? '牛客'
            : platform === 'xcpc_elo'
              ? 'XCPC ELO'
              : platform === 'codeforces'
                ? 'Codeforces'
                : 'AtCoder',
        exact: true,
      })
      .click()
    await expectAllRankingPages(
      page,
      expectedRows(
        members,
        (member) => member.stats[platform].currentRating,
        formatInteger,
        (member) => member.stats[platform].maxRating,
      ),
      '当前分',
      '历史最高',
    )
  }

  await page.getByRole('button', { name: '刷题榜', exact: true }).click()
  await expect(page.getByRole('heading', { name: '刷题榜', exact: true })).toBeVisible()
  await expectAllRankingPages(
    page,
    expectedRows(members, calculateTotalSolved, formatInteger),
    '总通过题数',
  )

  const solvedLabels: Record<(typeof solvedPlatforms)[number], string> = {
    codeforces: 'Codeforces',
    nowcoder: '牛客',
    atcoder: 'AtCoder',
    luogu: '洛谷',
    qoj: 'QOJ',
  }
  for (const platform of solvedPlatforms) {
    await page.getByRole('tab', { name: solvedLabels[platform], exact: true }).click()
    await expectAllRankingPages(
      page,
      expectedRows(members, (member) => member.stats[platform].solvedCount, formatInteger),
      '通过题数',
    )
  }

  expect(forbiddenMethods, 'production audit must not issue Supabase mutations').toEqual([])
  expect(failedPublicResponses, 'all browser public-view requests should succeed').toEqual([])
  expect(observedViews).toEqual(
    new Set(['public_members', 'public_platform_accounts', 'public_platform_stats']),
  )

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
})

test('authentication routes do not fetch public ranking views', async ({ page }) => {
  const publicViewRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === supabaseOrigin && url.pathname.startsWith('/rest/v1/public_')) {
      publicViewRequests.push(url.pathname)
    }
  })

  await page.goto('login')
  await expect(page).toHaveTitle('登录 | USTS ACM Land')
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible()
  expect(publicViewRequests).toEqual([])
})
