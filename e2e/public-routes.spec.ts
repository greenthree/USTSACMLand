import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

test('rankings supports a direct load and browser reload', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)

  await page.goto('/rankings')
  await expect(page).toHaveTitle('榜单 | USTS ACM Land')
  await expect(page.getByRole('heading', { name: 'Rating 榜' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Rating 榜' })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('the first keyboard step reaches the skip link and Enter moves focus to main', async ({
  page,
  browserName,
}) => {
  await page.goto('/')

  const skipLink = page.getByRole('link', { name: '跳转到主要内容' })
  if (browserName === 'webkit') {
    // Safari/WebKit link traversal follows the user's Full Keyboard Access preference.
    await skipLink.focus()
  } else {
    await page.keyboard.press('Tab')
  }
  await expect(skipLink).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.locator('main#main-content')).toBeFocused()
})

test('ranking controls form a real keyboard chain into the results', async ({
  page,
  browserName,
}) => {
  await page.goto('/rankings')

  const ratingMode = page.getByRole('button', { name: 'Rating 榜' })
  await ratingMode.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '刷题榜' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: '搜索成员' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: '专业筛选' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: '年级筛选' })).toBeFocused()
  await page.keyboard.press('Tab')

  const totalTab = page.getByRole('tab', { name: '总榜' })
  await expect(totalTab).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const codeforcesTab = page.getByRole('tab', { name: 'Codeforces' })
  await expect(codeforcesTab).toBeFocused()
  await expect(codeforcesTab).toHaveAttribute('aria-selected', 'true')

  const firstMember = page.getByRole('link', { name: /周知行/ })
  if (browserName === 'webkit') {
    // The same Safari preference controls whether Tab includes links.
    await firstMember.focus()
  } else {
    await page.keyboard.press('Tab')
  }
  await expect(firstMember).toBeFocused()
})

test('mobile navigation exposes state and restores focus after Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const menu = page.getByRole('button', { name: '打开导航' })
  await menu.click()
  await expect(page.getByRole('button', { name: '关闭导航' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()
})

test('anonymous account navigation returns after demo login', async ({ page }, testInfo) => {
  testInfo.setTimeout(45_000)
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount$/)

  await page.getByLabel('邮箱').fill('member@example.edu.cn')
  await page.getByLabel('密码').fill('demo-password')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/account$/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: '我的资料' })).toBeVisible()
})

test('public pages do not create page-level horizontal overflow', async ({ page }) => {
  for (const route of [
    '/',
    '/learning',
    '/daily-problem',
    '/rankings',
    '/members',
    '/privacy',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ]) {
    await page.goto(route)
    await expect(page.locator('main#main-content')).toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        {
          message: `${route} should fit within the viewport`,
          timeout: 15_000,
        },
      )
      .toBe(true)
  }
})
