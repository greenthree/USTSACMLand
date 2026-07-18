import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

test('daily problem is public and keeps member actions behind login', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)

  await page.goto('/daily-problem')
  await expect(page).toHaveTitle('每日一题 | USTS ACM Land')
  await expect(page.getByRole('heading', { name: '二分答案与可行性判断' })).toBeVisible()

  const source = page.getByRole('link', { name: '打开原题' })
  await expect(source).toHaveAttribute('href', /^https:\/\//)
  await expect(source).toHaveAttribute('target', '_blank')
  await expect(source).toHaveAttribute('rel', /noreferrer/)

  await expect(page.getByRole('link', { name: '登录后参与' })).toHaveAttribute(
    'href',
    '/login?returnTo=%2Fdaily-problem',
  )
  expect(runtimeErrors).toEqual([])
})

test('a recent daily problem has a reloadable date deep link', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto('/daily-problem')

  const archiveLinks = page.locator('.dp-archive a')
  await expect(archiveLinks.first()).toBeVisible()
  const href = await archiveLinks.first().getAttribute('href')
  expect(href).toMatch(/^\/daily-problem\/\d{4}-\d{2}-\d{2}$/)

  await page.goto(href!)
  await expect(page.getByRole('link', { name: '回到最新题目' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '每日一题' })).toBeAttached()
  expect(runtimeErrors).toEqual([])
})
