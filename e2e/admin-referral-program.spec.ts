import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, email]) => window.sessionStorage.setItem(key, email),
    [demoSessionKey, 'admin@example.edu.cn'],
  )
})

test('administrator can close the referral program through the audited confirmation flow', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto('/admin')

  const panel = page.getByRole('region', { name: '推荐计划' })
  await expect(panel.getByText('推荐计划正在运行')).toBeVisible({ timeout: 20_000 })
  const closeTrigger = panel.getByRole('button', { name: '关闭推荐计划' })
  await closeTrigger.click()

  const dialog = page.getByRole('dialog', { name: '确认关闭推荐计划' })
  const reason = dialog.getByRole('textbox', { name: '变更原因' })
  const confirmation = dialog.getByRole('checkbox', { name: /我已核对全站影响/ })
  const submit = dialog.getByRole('button', { name: '确认关闭' })
  await expect(reason).toBeFocused()
  await expect(submit).toBeDisabled()

  await reason.fill('生产异常期间暂停推荐')
  await confirmation.check()
  await submit.click()

  await expect(panel.getByText('推荐计划已暂停')).toBeVisible()
  await expect(panel.getByText('v2')).toBeVisible()
  await expect(panel.getByRole('status')).toContainText('推荐计划已全线关闭')
  const reopenTrigger = panel.getByRole('button', { name: '开启推荐计划' })
  await expect(reopenTrigger).toBeFocused()

  await reopenTrigger.click()
  const reopenDialog = page.getByRole('dialog', { name: '确认开启推荐计划' })
  await reopenDialog.getByRole('textbox', { name: '变更原因' }).press('Escape')
  await expect(reopenDialog).not.toBeVisible()
  await expect(reopenTrigger).toBeFocused()
  expect(runtimeErrors).toEqual([])
})
