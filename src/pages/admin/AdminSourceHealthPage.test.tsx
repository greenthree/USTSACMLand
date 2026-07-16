import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { AdminSourceHealth } from '../../types/domain'

const healthMocks = vi.hoisted(() => ({
  fetchHealth: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminOperations', () => ({
  fetchAdminSourceHealth: healthMocks.fetchHealth,
}))

import { AdminSourceHealthPage } from './AdminSourceHealthPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminSourceHealthPage />
    </MemoryRouter>,
  )
}

const healthRows: AdminSourceHealth[] = [
  {
    platform: 'codeforces',
    totalRuns: 40,
    succeededRuns: 40,
    failedRuns: 0,
    successRate: 100,
    averageDurationMs: 1_500,
    lastSuccessAt: '2026-07-15T08:00:00Z',
    lastFailureAt: null,
    latestErrorCode: null,
  },
  {
    platform: 'qoj',
    totalRuns: 4,
    succeededRuns: 3,
    failedRuns: 1,
    successRate: 75,
    averageDurationMs: 12_000,
    lastSuccessAt: '2026-07-15T07:00:00Z',
    lastFailureAt: '2026-07-15T08:10:00Z',
    latestErrorCode: 'auth_expired',
  },
]

describe('AdminSourceHealthPage with Supabase configured', () => {
  beforeEach(() => {
    healthMocks.fetchHealth.mockReset().mockResolvedValue(healthRows)
  })

  it('shows all platforms and distinguishes healthy, credential, and no-sample states', async () => {
    renderPage()

    const codeforces = await screen.findByRole('article', { name: 'Codeforces 健康状态' })
    const qoj = screen.getByRole('article', { name: 'QOJ 健康状态' })
    const atcoder = screen.getByRole('article', { name: 'AtCoder 健康状态' })

    expect(within(codeforces).getByText('正常')).toBeInTheDocument()
    expect(within(codeforces).getByText('100.0%')).toBeInTheDocument()
    expect(within(qoj).getByText('凭据异常')).toBeInTheDocument()
    expect(within(qoj).getByText('auth_expired')).toBeInTheDocument()
    expect(within(atcoder).getByText('无样本')).toBeInTheDocument()
    expect(healthMocks.fetchHealth).toHaveBeenCalledWith(168)
  })

  it('reloads the health projection when the statistics window changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('article', { name: 'Codeforces 健康状态' })
    await user.selectOptions(screen.getByRole('combobox', { name: '统计窗口' }), '24')

    expect(healthMocks.fetchHealth).toHaveBeenLastCalledWith(24)
    expect(healthMocks.fetchHealth).toHaveBeenCalledTimes(2)
  })

  it('shows a recoverable state when the health RPC fails', async () => {
    healthMocks.fetchHealth.mockRejectedValue(new Error('数据源健康状态读取失败：无权限'))

    renderPage()

    expect(await screen.findByText('数据源健康状态读取失败：无权限')).toHaveAttribute(
      'role',
      'status',
    )
    expect(screen.getByText('健康状态暂不可用')).toBeInTheDocument()
  })
})
