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

test('/training-goals passes the authenticated member axe gate', async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('usts-acm-land-demo-session:v1', 'member@example.edu.cn')
  })
  await page.goto('/training-goals')
  // The training-goals route is lazy-loaded. A cold WebKit/Vite server can
  // spend longer compiling this route than the shared 7.5s assertion budget.
  await expect(page.getByRole('heading', { name: '训练目标' })).toBeVisible({ timeout: 20_000 })
  await page.locator('main#main-content').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  assertNoViolations('/training-goals', results.violations)
})

for (const route of [
  '/admin',
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

test('skeleton elements disable shimmer animation and apply static background under prefers-reduced-motion: reduce', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('main#main-content').waitFor({ state: 'visible' })

  const evaluateSkeletonStyles = async () => {
    return await page.evaluate(() => {
      const container = document.createElement('div')
      container.className = 'table-skeleton'
      container.innerHTML = `
        <div class="skeleton-row">
          <div class="skeleton-cell skeleton-rank"></div>
          <div class="skeleton-cell skeleton-avatar"></div>
          <div class="skeleton-cell skeleton-member">
            <div class="skeleton-name"></div>
            <div class="skeleton-grade"></div>
          </div>
          <div class="skeleton-line"></div>
        </div>
      `
      document.body.appendChild(container)

      const cell = container.querySelector('.skeleton-cell')!
      const name = container.querySelector('.skeleton-name')!
      const grade = container.querySelector('.skeleton-grade')!
      const line = container.querySelector('.skeleton-line')!

      const cellStyle = window.getComputedStyle(cell)
      const nameStyle = window.getComputedStyle(name)
      const gradeStyle = window.getComputedStyle(grade)
      const lineStyle = window.getComputedStyle(line)

      const result = {
        cellAnimation: cellStyle.animationName,
        nameAnimation: nameStyle.animationName,
        gradeAnimation: gradeStyle.animationName,
        lineAnimation: lineStyle.animationName,
        cellBg: cellStyle.backgroundColor,
      }

      container.remove()
      return result
    })
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const normal = await evaluateSkeletonStyles()
  expect(normal.cellAnimation).toBe('skeleton-shimmer')
  expect(normal.nameAnimation).toBe('skeleton-shimmer')
  expect(normal.gradeAnimation).toBe('skeleton-shimmer')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await evaluateSkeletonStyles()
  expect(reduced.cellAnimation).toBe('none')
  expect(reduced.nameAnimation).toBe('none')
  expect(reduced.gradeAnimation).toBe('none')
  expect(reduced.lineAnimation).toBe('none')
  expect(reduced.cellBg).toBe('rgb(237, 242, 239)')
})
