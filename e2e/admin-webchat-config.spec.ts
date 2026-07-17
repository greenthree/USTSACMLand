import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, email]) => window.sessionStorage.setItem(key, email),
    [demoSessionKey, 'admin@example.edu.cn'],
  )
})

test('administrator can update the redacted WebChat configuration without persisting the key', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page)
  const replacementSecret = 'test_key_aaaaaaaaaaaaaaaa'

  await page.goto('/admin/webchat')

  await expect(page.getByRole('heading', { name: 'WebChat 配置' })).toBeVisible()
  await expect(page.getByText('已配置', { exact: true })).toBeVisible()
  await expect(page.getByText(/旧 Key 永不回显/)).toBeVisible()

  const model = page.getByRole('textbox', { name: /^模型/ })
  await model.fill('gpt-5.6-sol')
  await page.getByRole('checkbox', { name: /允许成员发起 AI 请求/ }).check()
  await page.getByRole('spinbutton', { name: /全站每日请求上限/ }).fill('400')
  await page.getByRole('spinbutton', { name: /全站每日 Token 上限/ }).fill('1200000')
  const apiKey = page.getByLabel(/替换 API Key/)
  await apiKey.fill(replacementSecret)
  await page.getByRole('textbox', { name: /修改原因/ }).fill('浏览器端配置回归验证')
  await page.getByRole('button', { name: '保存配置' }).click()

  await expect(page.getByText('WebChat 中转站配置已保存。')).toBeVisible()
  await expect(apiKey).toHaveValue('')
  await expect(page.getByText('v2')).toBeVisible()
  await expect(page.getByText('允许', { exact: true })).toBeVisible()

  const storedValues = await page.evaluate(() => [
    ...Object.values(window.localStorage),
    ...Object.values(window.sessionStorage),
  ])
  expect(storedValues.join('\n')).not.toContain(replacementSecret)
  expect(runtimeErrors).toEqual([])
})
