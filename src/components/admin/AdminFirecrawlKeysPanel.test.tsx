import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const firecrawlMocks = vi.hoisted(() => ({
  fetchKeys: vi.fn(),
  upsertKey: vi.fn(),
  deleteKey: vi.fn(),
  checkKey: vi.fn(),
}))

vi.mock('../../lib/adminFirecrawlKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adminFirecrawlKeys')>()),
  fetchAdminFirecrawlKeys: firecrawlMocks.fetchKeys,
  upsertAdminFirecrawlKey: firecrawlMocks.upsertKey,
  deleteAdminFirecrawlKey: firecrawlMocks.deleteKey,
  checkAdminFirecrawlKey: firecrawlMocks.checkKey,
}))

import { AdminFirecrawlKeysPanel } from './AdminFirecrawlKeysPanel'

const key = {
  id: '00000000-0000-4000-8000-000000000301',
  label: '主额度池',
  keyConfigured: true,
  enabled: true,
  priority: 100,
  healthStatus: 'healthy' as const,
  consecutiveFailures: 0,
  cooldownUntil: null,
  lastSelectedAt: '2026-07-19T07:00:00.000Z',
  lastCheckedAt: '2026-07-19T08:00:00.000Z',
  lastSuccessAt: '2026-07-19T08:00:00.000Z',
  lastFailureAt: null,
  lastErrorCode: null,
  creditsRemaining: 409,
  creditsTotal: 1000,
  billingPeriodEnd: '2026-07-24T12:37:07.733Z',
  version: 2,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-19T08:00:00.000Z',
}

describe('AdminFirecrawlKeysPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    firecrawlMocks.fetchKeys.mockReset().mockResolvedValue([key])
    firecrawlMocks.upsertKey.mockReset().mockResolvedValue({ ...key, version: 3 })
    firecrawlMocks.deleteKey.mockReset().mockResolvedValue(key.id)
    firecrawlMocks.checkKey.mockReset().mockResolvedValue({
      key,
      succeeded: true,
      errorCode: null,
    })
  })

  it('shows per-key health and refreshes one key without exposing its secret', async () => {
    const user = userEvent.setup()
    render(<AdminFirecrawlKeysPanel />)
    const card = await screen.findByRole('article')
    expect(within(card).getByText('409 / 1,000')).toBeInTheDocument()
    expect(within(card).getByText('Vault 已配置')).toBeInTheDocument()
    expect(screen.queryByText(/API Key.*fc-/)).not.toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: '检查' }))
    expect(firecrawlMocks.checkKey).toHaveBeenCalledWith(key.id)
    expect(await screen.findByText(/检查成功/)).toBeInTheDocument()
  })

  it('clears a newly submitted key before the request settles and creates it disabled', async () => {
    const user = userEvent.setup()
    let resolveCreate: ((value: typeof key) => void) | undefined
    firecrawlMocks.upsertKey.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    render(<AdminFirecrawlKeysPanel />)
    await screen.findByText('主额度池')
    await user.click(screen.getByRole('button', { name: '新增 Key' }))
    await user.type(screen.getByRole('textbox', { name: 'Key 名称' }), '备用额度池')
    const apiKey = screen.getByLabelText(/^API Key/)
    await user.type(apiKey, 'fc-new-secret-aaaaaaaa')
    await user.type(screen.getByRole('textbox', { name: '创建原因' }), '增加备用额度池')
    await user.click(screen.getByRole('button', { name: '写入 Vault' }))

    expect(apiKey).toHaveValue('')
    expect(firecrawlMocks.upsertKey).toHaveBeenCalledWith({
      keyId: null,
      label: '备用额度池',
      apiKey: 'fc-new-secret-aaaaaaaa',
      enabled: false,
      priority: 100,
      expectedVersion: null,
      reason: '增加备用额度池',
    })
    expect(JSON.stringify(localStorage)).not.toContain('fc-new-secret-aaaaaaaa')
    expect(JSON.stringify(sessionStorage)).not.toContain('fc-new-secret-aaaaaaaa')
    resolveCreate?.({
      ...key,
      id: '00000000-0000-4000-8000-000000000302',
      label: '备用额度池',
      enabled: false,
    })
    expect(await screen.findByText(/已写入 Vault/)).toBeInTheDocument()
  })

  it('forces a rotated key offline and sends an optimistic version with the reason', async () => {
    const user = userEvent.setup()
    render(<AdminFirecrawlKeysPanel />)
    const card = await screen.findByRole('article')
    await user.click(within(card).getByRole('button', { name: '编辑' }))
    const replacement = screen.getByLabelText(/^替换 API Key/)
    await user.type(replacement, 'fc-rotated-secret-bbbbb')
    await user.type(screen.getByRole('textbox', { name: '修改或删除原因' }), '轮换生产密钥')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() =>
      expect(firecrawlMocks.upsertKey).toHaveBeenCalledWith({
        keyId: key.id,
        label: key.label,
        apiKey: 'fc-rotated-secret-bbbbb',
        enabled: false,
        priority: 100,
        expectedVersion: 2,
        reason: '轮换生产密钥',
      }),
    )
    expect(replacement).toHaveValue('')
  })

  it('does not allow an exhausted disabled key to be enabled', async () => {
    const user = userEvent.setup()
    firecrawlMocks.fetchKeys.mockResolvedValue([
      { ...key, enabled: false, healthStatus: 'critical', creditsRemaining: 0 },
    ])
    render(<AdminFirecrawlKeysPanel />)
    const card = await screen.findByRole('article')
    await user.click(within(card).getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('checkbox', { name: /允许运行时选择此 Key/ })).toBeDisabled()
  })
})
