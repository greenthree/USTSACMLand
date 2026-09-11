import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

test.use({ reducedMotion: 'reduce' })

for (const width of [390, 820, 1024, 1440, 1920]) {
  test(`learning content and plan entry fit the viewport at ${width}px`, async ({ page }) => {
    const errors = collectRuntimeErrors(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/learning')
    await expect(page.getByRole('heading', { name: /新手学习引导/ })).toBeVisible()

    await page.getByRole('link', { name: '开始四周计划' }).click()
    await expect(page).toHaveURL(/#learning-first-month$/)
    await expect(page.getByRole('tab', { name: /第 1 周/ })).toBeInViewport()

    // Check content bounds as well as the document: overflow: clip can hide a broken column.
    const layout = await page.evaluate(() => {
      const selectors = [
        '.learning-hero-copy',
        '.learning-start-panel',
        '.learning-week-panel:not([hidden]) > div',
        '.learning-stage.is-open .learning-stage-notes',
        '.learning-platform > *',
        '.learning-knowledge-branches',
        '.learning-knowledge-detail',
        '.learning-rhythm-grid article',
        '.learning-resource-list a',
        '.learning-community-action',
      ]
      return {
        pageFits: document.documentElement.scrollWidth <= innerWidth + 1,
        clipped: [...document.querySelectorAll(selectors.join(', '))]
          .filter((element) => {
            const box = element.getBoundingClientRect()
            return box.width <= 0 || box.left < -1 || box.right > innerWidth + 1
          })
          .map((element) => element.className),
      }
    })
    expect(layout).toEqual({ pageFits: true, clipped: [] })
    expect(errors).toEqual([])
  })
}

for (const width of [390, 1440]) {
  test(`learning controls remain usable at ${width}px`, async ({ page }) => {
    const errors = collectRuntimeErrors(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/learning')

    await page.getByRole('button', { name: '已经会基础语法' }).click()
    await expect(page.getByRole('link', { name: '洛谷推荐入口（新窗口打开）' })).toBeVisible()
    await expect(page.locator('.learning-platform.is-recommended')).toContainText('洛谷')

    await page.getByRole('link', { name: '开始四周计划' }).click()
    await page.getByRole('tab', { name: /第 1 周/ }).focus()
    await page.keyboard.press('ArrowRight')
    const weekTwo = page.getByRole('tab', { name: /第 2 周/ })
    await expect(weekTwo).toBeFocused()
    await expect(weekTwo).toHaveAttribute('aria-selected', 'true')
    await page.getByText('掌握数组与字符串', { exact: true }).click()
    await expect(weekTwo).toContainText('1/3')
    await expect(page.getByRole('progressbar', { name: '四周学习进度' })).toHaveAttribute(
      'aria-valuenow',
      '8',
    )

    // Verify persistence through rendered state without inspecting browser storage.
    await page.reload()
    await page.getByRole('tab', { name: /第 2 周/ }).click()
    await expect(page.getByRole('checkbox', { name: '掌握数组与字符串' })).toBeChecked()
    await page.getByRole('button', { name: '重置进度' }).click()
    await expect(page.getByRole('progressbar', { name: '四周学习进度' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )

    await page.getByRole('button', { name: /从会做题，到在有限时间里做出选择/ }).click()
    await page.getByRole('link', { name: '返回阶段一' }).click()
    await expect(page.getByLabel('环境与语法知识点')).toBeVisible()
    await page.getByRole('button', { name: '数据结构', exact: true }).click()
    await page.getByRole('button', { name: '区间维护', exact: true }).click()
    await expect(page.getByRole('article', { name: '区间维护' })).toContainText('可持久化结构')

    const accessibility = await new AxeBuilder({ page })
      .include('.learning-page')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(accessibility.violations).toEqual([])
    expect(errors).toEqual([])
  })
}
