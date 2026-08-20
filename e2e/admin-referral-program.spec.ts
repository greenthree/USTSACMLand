import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, email]) => window.sessionStorage.setItem(key, email),
    [demoSessionKey, 'admin@example.edu.cn'],
  )
})

test('administrator can inspect the read-only closed referral program without mutation buttons', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto('/admin')

  const panel = page.getByRole('region', { name: '推荐计划' })
  await expect(panel.getByText('只读关闭', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(panel.locator('strong', { hasText: '推荐计划已永久关闭' })).toBeVisible()
  await expect(panel.getByText('v1')).toBeVisible()
  await expect(panel.getByText('系统')).toBeVisible()

  // 断言无开启/关闭按钮与弹窗
  await expect(panel.getByRole('button', { name: /开启/ })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /关闭/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 刷新状态正常响应且保持只读关闭
  const refreshButton = panel.getByRole('button', { name: '刷新状态' })
  await expect(refreshButton).toBeVisible()
  await refreshButton.click()
  await expect(panel.getByText('只读关闭', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: /开启/ })).toHaveCount(0)

  expect(runtimeErrors).toEqual([])
})
