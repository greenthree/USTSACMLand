import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('practice ranking switches between cumulative, preset and custom ranges', async ({ page }) => {
  await page.goto('/rankings')
  await page.getByRole('button', { name: '刷题榜' }).click()

  await expect(page.getByRole('button', { name: '累计总数' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('[data-label="总通过题数"]').first()).toBeVisible()

  await page.getByRole('button', { name: '本周' }).click()
  await expect(page.getByRole('heading', { name: '刷题增量榜' })).toBeVisible()
  await expect(
    page.getByText('北京时间；仅统计区间前有基线且区间内有成功观测的平台。'),
  ).toBeVisible()
  await expect(page.locator('[data-label="区间新增题数"]').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Codeforces' }).click()
  await expect(page.locator('[data-label="新增通过题数"]').first()).toBeVisible()
  await expect(page.locator('[data-label="区间末累计"]').first()).toBeVisible()
  await expect(page.getByText('统计完整').first()).toBeVisible()

  await page.getByRole('button', { name: '本月' }).click()
  await expect(page.getByRole('button', { name: '本月' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '自定义' }).click()
  const startDate = page.getByLabel('开始日期')
  const endDate = page.getByLabel('结束日期')
  const today = await endDate.getAttribute('max')
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await startDate.fill(today!)
  await endDate.fill(today!)
  await page.getByRole('button', { name: '应用范围' }).click()
  await expect(page.locator('.ranking-period-summary strong')).toContainText(today!.slice(0, 4))

  const viewport = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(viewport.body).toBeLessThanOrEqual(viewport.viewport)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([])

  await page.getByRole('button', { name: '累计总数' }).click()
  await expect(page.getByRole('heading', { name: '刷题榜' })).toBeVisible()
  await expect(page.locator('[data-label="通过题数"]').first()).toBeVisible()
})

test('custom practice range reports invalid date order without replacing the applied range', async ({
  page,
}) => {
  await page.goto('/rankings')
  await page.getByRole('button', { name: '刷题榜' }).click()
  await page.getByRole('button', { name: '自定义' }).click()

  const startDate = page.getByLabel('开始日期')
  const endDate = page.getByLabel('结束日期')
  const today = await endDate.getAttribute('max')
  await startDate.fill(today!)
  await endDate.fill('2026-01-01')
  await page.getByRole('button', { name: '应用范围' }).click()

  await expect(page.getByRole('alert')).toHaveText('开始日期不能晚于结束日期。')
  await expect(page.getByRole('heading', { name: '刷题增量榜' })).toBeVisible()
  await expect(page.locator('[data-label="区间新增题数"]').first()).toBeVisible()
})
