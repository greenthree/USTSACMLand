import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, email]) => window.sessionStorage.setItem(key, email),
    [demoSessionKey, 'admin@example.edu.cn'],
  )
})

test('administrator can inspect the read-only archived WebChat configuration', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)

  await page.goto('/admin/webchat')

  await expect(page.getByRole('heading', { name: 'WebChat 配置' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText('已配置', { exact: true })).toBeVisible()

  const archive = page.getByRole('region', { name: '遗留配置快照' })
  await expect(archive).toBeVisible()
  await expect(archive).toContainText('配置、密钥、预算与请求开关均不可修改')
  await expect(archive).toContainText('页面只显示是否存在历史 Key，不读取原值')
  await expect(archive.getByText('已保存（不读取原值）')).toBeVisible()
  await expect(archive.getByText('已暂停')).toBeVisible()

  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('spinbutton')).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存配置' })).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('administrator can inspect the pilot roster and open its member policy', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)

  await page.goto('/admin/webchat')

  const pilot = page.getByRole('region', { name: 'AI 助手账号与用量' })
  await expect(pilot).toBeVisible({ timeout: 20_000 })
  await expect(pilot.getByLabel('AI 助手账号摘要')).toContainText('已配置账号')
  await expect(pilot.getByRole('heading', { name: 'AI 助手账号与用量' })).toBeVisible()
  await expect(pilot.getByText('8 / 300')).toBeVisible()
  await expect(pilot.getByText(/已结算 18,420 · 预留 4,000 · 剩余 977,580/)).toBeVisible()

  await pilot.getByRole('link', { name: '查看详情' }).click()
  await expect(page).toHaveURL(/\/admin\/members\/member-1$/)

  const access = page
    .getByRole('heading', { name: 'AI 助手历史授权' })
    .locator('xpath=ancestor::section[1]')
  await expect(access).toContainText('产品入口已关闭')
  await expect(access).toContainText('历史授权值仅用于对账，不代表成员当前可以发起 AI 请求')
  await expect(access).toContainText('停止前授权值')
  await expect(access).toContainText('已授权')
  await expect(access).toContainText('只读关闭')
  await expect(access).toContainText('300')
  await expect(access).toContainText('1,000,000')
  await expect(access.getByRole('checkbox')).toHaveCount(0)
  await expect(access.getByRole('spinbutton')).toHaveCount(0)
  await expect(access.getByRole('textbox')).toHaveCount(0)
  await expect(access.getByRole('button', { name: /保存|授权/ })).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})
