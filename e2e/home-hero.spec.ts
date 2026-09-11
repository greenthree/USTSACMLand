import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

test.use({ reducedMotion: 'reduce' })

for (const width of [390, 768, 1024, 1440, 1920]) {
  test(`home hero keeps its copy and balloons inside the frame at ${width}px`, async ({ page }) => {
    const errors = collectRuntimeErrors(page)
    await page.setViewportSize({ width, height: 1080 })
    await page.goto('/')

    // Check both initial lazy CSS loading and a return from another page.
    for (let visit = 0; visit < 2; visit += 1) {
      await expect(page.locator('.home-balloon')).toHaveCount(5)
      await expect(page.getByRole('heading', { name: /USTS ACM Land/ })).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const frame = document.querySelector('.home-hero-art')!.getBoundingClientRect()
            const copy = document.querySelector('.home-hero-copy')!.getBoundingClientRect()
            const panel = document.querySelector('.home-hero-instrument')!.getBoundingClientRect()
            const copyFits = copy.width > 0 && copy.left >= 0 && copy.right <= innerWidth
            const panelFits = panel.left >= 0 && panel.right <= innerWidth
            const separated = copy.right <= panel.left || copy.bottom <= panel.top
            const balloonsFit = [...document.querySelectorAll('.home-balloon')].every((balloon) => {
              const box = balloon.getBoundingClientRect()
              return (
                box.left >= frame.left &&
                box.right <= frame.right &&
                box.top >= frame.top &&
                box.bottom <= frame.bottom
              )
            })
            return (
              document.documentElement.scrollWidth <= innerWidth &&
              copyFits &&
              panelFits &&
              separated &&
              balloonsFit
            )
          }),
        )
        .toBe(true)

      if (visit === 0) {
        await page.getByRole('link', { name: '新手入门', exact: true }).click()
        await expect(page).toHaveURL(/\/learning$/)
        await expect(page.getByRole('heading', { name: /新手学习引导/ })).toBeVisible()
        await page.getByRole('link', { name: /USTS ACM Land/ }).click()
        await expect(page).toHaveURL(/\/$/)
      }
    }
    expect(errors).toEqual([])
  })
}
