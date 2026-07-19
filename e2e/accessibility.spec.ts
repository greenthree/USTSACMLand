import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

interface AxeViolationSummary {
  id: string
  help: string
  nodes: Array<{ target: unknown[] }>
}

function assertNoViolations(route: string, violations: AxeViolationSummary[]) {
  if (violations.length === 0) return

  const summary = violations
    .map((violation) => {
      const targets = violation.nodes
        .slice(0, 12)
        .map((node) => node.target.join(' '))
        .join(', ')
      const suffix = violation.nodes.length > 12 ? `，另有 ${violation.nodes.length - 12} 处` : ''
      return `${violation.id}: ${violation.help} (${targets}${suffix})`
    })
    .join('\n')
  throw new Error(`${route} 存在 ${violations.length} 类 axe 问题：\n${summary}`)
}

for (const route of [
  '/',
  '/learning',
  '/daily-problem',
  '/rankings',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
]) {
  test(`${route} has no automatically detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route)
    await page.locator('main#main-content').waitFor({ state: 'visible' })
    await page.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    assertNoViolations(route, results.violations)
  })
}

test('/account passes the authenticated member axe gate', async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('usts-acm-land-demo-session:v1', 'member@example.edu.cn')
  })
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: '我的资料' })).toBeVisible()
  await page.locator('main#main-content').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  assertNoViolations('/account', results.violations)
})

for (const route of [
  '/admin/accounts',
  '/admin/daily-problems',
  '/admin/members',
  '/admin/sync',
  '/admin/webchat',
  '/admin/members/member-1',
]) {
  test(`${route} passes the administrator axe gate`, async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('usts-acm-land-demo-session:v1', 'admin@example.edu.cn')
    })
    await page.goto(route)
    await page.locator('main#main-content').waitFor({ state: 'visible' })
    await page.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    assertNoViolations(route, results.violations)
  })
}
