import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

test.use({ reducedMotion: 'reduce' })

for (const width of [390, 1440, 1920]) {
  test(`campus contests show school then practice with individual rules at ${width}px`, async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const events = page.locator('.home-join-events article')
    await expect(events).toHaveCount(2)
    await expect(events.nth(0)).toContainText('11 月')
    await expect(events.nth(0)).toContainText('校赛')
    await expect(events.nth(1)).toContainText('03 月')
    await expect(events.nth(1)).toContainText('练习赛')
    await page.getByRole('link', { name: '了解校赛' }).click()
    await expect(page).toHaveURL(/\/contests\/campus$/)
    const picker = page.getByRole('tablist', { name: '选择校内赛事' })
    await expect(picker.getByRole('tab')).toHaveCount(2)
    await expect(picker.getByRole('tab').nth(0)).toContainText('11月 · 单人赛')
    await expect(picker.getByRole('tab').nth(1)).toContainText('3月')

    for (const contest of ['校赛', '练习赛', '校赛']) {
      await picker.getByRole('tab', { name: new RegExp(contest) }).click()
      await page
        .getByRole('heading', { name: contest, exact: true, level: 1 })
        .scrollIntoViewIfNeeded()
      await expect(
        page.getByRole('heading', { name: contest, exact: true, level: 1 }),
      ).toBeInViewport()
      const overview = page.getByLabel(`${contest}赛制概览`)
      await expect(overview).toContainText('03:00:00')
      await expect(overview).toContainText(contest === '校赛' ? '单人赛' : '个人选拔赛')
      await expect(page.locator('body')).not.toContainText('新生赛')
      await expect(page.locator('.campus-contest-content')).not.toContainText('三人组队')
      for (const section of await page.locator('.freshman-contest-section').all()) {
        await section.scrollIntoViewIfNeeded()
        await expect
          .poll(() =>
            section.evaluate((el) => {
              const title = el.querySelector('h2')!.getBoundingClientRect()
              return (
                title.left >= 0 &&
                title.right <= innerWidth + 1 &&
                document.documentElement.scrollWidth <= innerWidth + 1
              )
            }),
          )
          .toBe(true)
      }
    }
    await page.reload()
    await expect(page.getByRole('heading', { name: '校赛', exact: true, level: 1 })).toBeVisible()
    expect(errors).toEqual([])
  })
}
