import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

test.use({ reducedMotion: 'reduce' })

for (const width of [320, 390, 430, 768, 1024, 1440, 1920]) {
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

for (const width of [320, 390, 430, 768, 1024, 1440, 1920]) {
  test(`home sections keep their content readable at ${width}px`, async ({ page }) => {
    const errors = collectRuntimeErrors(page)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.locator('.home-section')).toHaveCount(6)

    // Validate initial lazy CSS loading and a return from learning.
    for (let visit = 0; visit < 2; visit += 1) {
      for (const section of await page.locator('.home-section').all()) {
        // content-visibility:auto defers offscreen layout until the section is approached.
        await section.scrollIntoViewIfNeeded()
        await expect(section.locator('h2')).toBeVisible()
        await expect
          .poll(() =>
            section.evaluate((element) => {
              const content = element.querySelectorAll('h2, h3, p, article, a, .home-section-meta')
              return [...content]
                .filter((item) => {
                  const box = item.getBoundingClientRect()
                  return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
                })
                .map((item) => item.textContent?.trim().slice(0, 40))
            }),
          )
          .toEqual([])

        const headingFits = await section.locator('.home-section-heading').evaluate((heading) => {
          const title = heading.querySelector('h2')!.getBoundingClientRect()
          const meta = heading.querySelector('.home-section-meta')?.getBoundingClientRect()
          return (
            !meta ||
            meta.width === 0 ||
            title.bottom <= meta.top ||
            meta.bottom <= title.top ||
            title.right <= meta.left ||
            meta.right <= title.left
          )
        })
        expect(headingFits).toBe(true)
      }
      if (visit === 0) {
        await page.locator('.home-hero-actions').getByRole('link', { name: '新手入门' }).click()
        await expect(page.getByRole('heading', { name: /新手学习引导/ })).toBeVisible()
        await page.getByRole('link', { name: /USTS ACM Land/ }).click()
        await expect(page).toHaveURL(/\/$/)
        await expect(page.locator('.home-section')).toHaveCount(6)
      }
    }
    expect(errors).toEqual([])
  })
}

test('home mobile menu opens learning and closes after navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '学习', exact: true }).click()
  await page
    .getByRole('group', { name: '学习导航', exact: true })
    .getByRole('link', { name: '新手入门' })
    .click()
  await expect(page.getByRole('heading', { name: /新手学习引导/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开导航' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})
