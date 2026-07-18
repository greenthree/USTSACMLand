import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const demoSessionKey = 'usts-acm-land-demo-session:v1'
const appBaseUrl = 'http://127.0.0.1:4175'
const mockBaseUrl = 'http://127.0.0.1:4176'

async function resetMock(request: APIRequestContext) {
  const response = await request.post(`${mockBaseUrl}/debug/reset`)
  expect(response.ok()).toBe(true)
}

async function openAsMember(page: Page) {
  await page.addInitScript(([key, email]) => window.sessionStorage.setItem(key, email), [
    demoSessionKey,
    'member@example.edu.cn',
  ] as const)
  await page.goto('/assistant')
  await expect(page).toHaveTitle('AI 学习助手 | USTS ACM Land')
  await expect(page.getByRole('heading', { name: /把卡住你的地方，\s*放到桌面上。/ })).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  await resetMock(request)
})

test('anonymous visitors return to the assistant route after login', async ({ page }) => {
  await page.goto('/assistant')

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fassistant$/)
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
})

test('authenticated members send a typed request and receive a streamed reply', async ({
  page,
  request,
}) => {
  await openAsMember(page)
  const menuButton = page.getByRole('button', { name: '打开导航' })
  if (await menuButton.isVisible()) await menuButton.click()
  await expect(page.getByRole('link', { name: 'AI 助手' })).toBeVisible()

  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('请帮我检查二分答案的边界')
  await composer.press('Enter')

  await expect(page.getByText('先确认边界，再验证单调性，最后检查复杂度。')).toBeVisible()
  const debug = await (await request.get(`${mockBaseUrl}/debug`)).json()
  expect(debug).toMatchObject({
    requestCount: 1,
    lastRequest: {
      authorizationValid: true,
      requestIdValid: true,
      messageRoles: ['user'],
      topLevelFields: ['id', 'messages', 'trigger'],
    },
  })

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除对话', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '把题意、思路或代码放到工作台上。' }),
  ).toBeVisible()
})

test('the active conversation survives refresh and remains available in history', async ({
  page,
}) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('刷新恢复验证')
  await composer.press('Enter')
  await expect(page.getByText('先确认边界，再验证单调性，最后检查复杂度。')).toBeVisible()

  const historyItem = page.getByRole('button', { name: /刷新恢复验证/ }).first()
  await expect(historyItem).toBeVisible()
  await page.reload()

  await expect(page.getByText('刷新恢复验证', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('先确认边界，再验证单调性，最后检查复杂度。')).toBeVisible()

  await page.getByRole('button', { name: '新建对话' }).click()
  await expect(
    page.getByRole('heading', { name: '把题意、思路或代码放到工作台上。' }),
  ).toBeVisible()
  await historyItem.click()
  await expect(page.getByText('先确认边界，再验证单调性，最后检查复杂度。')).toBeVisible()
})

test('the workbench shows thinking until the first visible reply text arrives', async ({
  page,
}) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('检查思考状态')
  await composer.press('Enter')

  await expect(page.getByText('思考中', { exact: true })).toBeVisible()
  await expect(page.getByText('思考状态结束。')).toBeVisible()
  await expect(page.getByText('思考中', { exact: true })).toHaveCount(0)
})

test('stop generation aborts the in-flight upstream stream', async ({ page, request }) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('输出长回复')
  await composer.press('Enter')

  await expect(page.getByText(/流式片段 1/)).toBeVisible()
  const stopButton = page.getByRole('button', { name: '停止生成' })
  await expect(stopButton).toBeVisible()
  await stopButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '发送问题' })).toBeVisible()

  await page.waitForTimeout(250)
  const partial = await page.locator('.assistant-message-model').textContent()
  await page.waitForTimeout(250)
  expect(await page.locator('.assistant-message-model').textContent()).toBe(partial)

  await expect
    .poll(async () => {
      const debug = await (await request.get(`${mockBaseUrl}/debug`)).json()
      return debug.abortedRequests
    })
    .toBeGreaterThanOrEqual(1)
})

test('ten browser sessions stream independently without cross-talk', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'single load-test project')

  const context = await browser.newContext()
  await context.addInitScript(([key, email]) => window.sessionStorage.setItem(key, email), [
    demoSessionKey,
    'member@example.edu.cn',
  ] as const)
  const pages = await Promise.all(Array.from({ length: 10 }, () => context.newPage()))

  try {
    await Promise.all(pages.map((sessionPage) => sessionPage.goto(`${appBaseUrl}/assistant`)))
    await Promise.all(
      pages.map(async (sessionPage, index) => {
        const composer = sessionPage.getByRole('textbox', { name: '向 AI 学习助手提问' })
        await composer.fill(`并发会话 ${index + 1}`)
        await composer.press('Enter')
      }),
    )
    await Promise.all(
      pages.map((sessionPage, index) =>
        expect(sessionPage.getByText(`并发回复 ${index + 1}：流式隔离验证完成。`)).toBeVisible(),
      ),
    )

    await expect
      .poll(async () => {
        const debug = await (await request.get(`${mockBaseUrl}/debug`)).json()
        return debug.activeStreams
      })
      .toBe(0)
    const debug = await (await request.get(`${mockBaseUrl}/debug`)).json()
    expect(debug).toMatchObject({
      requestCount: 10,
      abortedRequests: 0,
    })
    expect(debug.peakConcurrentStreams).toBeGreaterThanOrEqual(6)
  } finally {
    await context.close()
  }
})

test('the relay transport sustains ten simultaneous streams', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'single load-test project')

  const responses = await Promise.all(
    Array.from({ length: 10 }, async (_, index) => {
      const response = await fetch(`${mockBaseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ustsacmland-demo-webchat-token',
          'content-type': 'application/json',
          origin: appBaseUrl,
          'x-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          trigger: 'submit-message',
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'user',
              parts: [{ type: 'text', text: `并发会话 ${index + 1}` }],
            },
          ],
        }),
      })
      expect(response.ok).toBe(true)
      return response.text()
    }),
  )

  responses.forEach((body, index) => {
    expect(body).toContain(`并发回复 ${index + 1}：`)
    expect(body).toContain('流式隔离验证完成。')
  })
  const debug = await (await request.get(`${mockBaseUrl}/debug`)).json()
  expect(debug).toMatchObject({
    requestCount: 10,
    abortedRequests: 0,
    activeStreams: 0,
    peakConcurrentStreams: 10,
  })
})

test('quota errors remain visible without an automatic retry', async ({ page, request }) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('触发限流')
  await composer.press('Enter')

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('发送过于频繁，请稍后再试')
  await expect(alert).toContainText('建议等待 9 秒后再试')
  await expect(alert.getByRole('button', { name: '重新发送' })).toHaveCount(0)
  await page.waitForTimeout(300)
  expect((await (await request.get(`${mockBaseUrl}/debug`)).json()).requestCount).toBe(1)
})

test('cumulative member quota exhaustion does not promise a daily reset', async ({
  page,
  request,
}) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('触发累计额度耗尽')
  await composer.press('Enter')

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('AI 助手累计请求次数已用完')
  await expect(alert).not.toContainText('建议等待')
  await expect(alert).not.toContainText('重置')
  await expect(alert.getByRole('button', { name: '重新发送' })).toHaveCount(0)
  await page.waitForTimeout(300)
  expect((await (await request.get(`${mockBaseUrl}/debug`)).json()).requestCount).toBe(1)
})

test('an expired session signs out locally before returning to login', async ({ page }) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('触发登录失效')
  await composer.press('Enter')

  await expect(page.getByRole('alert')).toContainText('登录状态已失效，请重新登录。')
  await page.getByRole('button', { name: '重新登录' }).click()
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fassistant$/)
  await expect(page.getByRole('button', { name: '登录' })).toBeEnabled()
})

test('a revoked member sees the denial without a retry action', async ({ page, request }) => {
  await openAsMember(page)
  const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
  await composer.fill('触发未授权')
  await composer.press('Enter')

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('当前账号不能使用 AI 学习助手。')
  await expect(alert.getByRole('button', { name: '重新发送' })).toHaveCount(0)
  await expect(alert.getByRole('button', { name: '重新检查权限' })).toBeVisible()
  await alert.getByRole('button', { name: '重新检查权限' }).click()
  await page.waitForTimeout(300)
  expect((await (await request.get(`${mockBaseUrl}/debug`)).json()).requestCount).toBe(1)
})

for (const failure of [
  { prompt: '触发网关失败', message: '中转站暂时不可用，请稍后重试。' },
  { prompt: '触发网关超时', message: '中转站响应超时，请稍后重试。' },
]) {
  test(`${failure.prompt} can be retried explicitly after the transient failure`, async ({
    page,
    request,
  }) => {
    await openAsMember(page)
    const composer = page.getByRole('textbox', { name: '向 AI 学习助手提问' })
    await composer.fill(failure.prompt)
    await composer.press('Enter')

    const alert = page.getByRole('alert')
    await expect(alert).toContainText(failure.message)
    await alert.getByRole('button', { name: '重新发送' }).click()
    await expect(page.getByText('上游连接已经恢复，可以继续提问。')).toBeVisible()
    expect((await (await request.get(`${mockBaseUrl}/debug`)).json()).requestCount).toBe(2)
  })
}

test('mobile workbench has no page overflow and passes the axe gate', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile-specific gate')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openAsMember(page)

  const composerActionMotion = await page
    .getByRole('button', { name: '发送问题' })
    .evaluate((element) => {
      const style = window.getComputedStyle(element)
      return { animationName: style.animationName, transitionDuration: style.transitionDuration }
    })
  expect(composerActionMotion).toEqual({ animationName: 'none', transitionDuration: '0s' })

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})
