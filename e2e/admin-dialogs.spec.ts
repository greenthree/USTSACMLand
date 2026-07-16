import { expect, test } from '@playwright/test'
import { collectRuntimeErrors } from './helpers'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, email]) => window.sessionStorage.setItem(key, email),
    [demoSessionKey, 'admin@example.edu.cn'],
  )
})

test('platform-account dialog traps focus and returns it after Escape', async ({ page }) => {
  await page.goto('/admin/accounts')

  const trigger = page.getByRole('button', {
    name: '标记 沈亦安 的 Codeforces 账号无效',
  })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '标记 沈亦安 的 Codeforces 账号无效' })
  const reason = dialog.getByRole('textbox', { name: '无效原因' })
  const close = dialog.getByRole('button', { name: '关闭无效账号对话框' })
  const confirm = dialog.getByRole('button', { name: '确认无效' })
  await expect(reason).toBeFocused()

  await reason.fill('自动化焦点测试')
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('full-sync confirmation traps focus and returns it after Escape', async ({ page }) => {
  await page.goto('/admin/sync')

  const trigger = page.getByRole('button', { name: '同步全部成员' })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '同步全部成员' })
  const cancel = dialog.getByRole('button', { name: '取消' })
  const confirm = dialog.getByRole('button', { name: '确认同步' })
  await expect(cancel).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('administrator handoff requires a reason, confirmation, and focus containment', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(45_000)
  await page.goto('/admin/members')

  const trigger = page.getByRole('button', { name: '提升 沈亦安' })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '授予管理员权限' })
  const reason = dialog.getByRole('textbox', { name: '变更原因' })
  const close = dialog.getByRole('button', { name: '关闭成员角色对话框' })
  const confirm = dialog.getByRole('button', { name: '确认授权' })
  await expect(reason).toBeFocused()
  await expect(confirm).toBeDisabled()

  await reason.fill('浏览器端管理员交接回归验证')
  await dialog.getByRole('checkbox', { name: /我已核对目标账号与权限影响/ }).check()
  await expect(confirm).toBeEnabled()

  await close.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('XCPC ELO manual entry preserves decimal Ratings in the rendered member detail', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto('/admin/members/member-1')

  const trigger = page.getByRole('button', { name: '手工录入 XCPC ELO 数据' })
  await expect(trigger).toBeEnabled()
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '手工录入 XCPC ELO 数据' })
  const current = dialog.getByRole('spinbutton', { name: '当前 Rating' })
  const maximum = dialog.getByRole('spinbutton', { name: '历史最高 Rating' })
  await expect(current).toBeFocused()
  await expect(current).toHaveAttribute('inputmode', 'decimal')
  await expect(current).toHaveAttribute('step', '0.01')
  await expect(maximum).toHaveAttribute('step', '0.01')

  await current.fill('1734.5')
  await maximum.fill('1812.25')
  await dialog.getByRole('textbox', { name: '录入原因' }).fill('浏览器端小数回归验证')
  await dialog.getByRole('button', { name: '保存手工数据' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByText('XCPC ELO 手工数据已保存。')).toBeVisible()
  const xcpcRow = page.getByRole('row', { name: /XCPC ELO/ })
  await expect(xcpcRow).toContainText('1,734.5')
  await expect(xcpcRow).toContainText('1,812.25')
  expect(runtimeErrors).toEqual([])
})
