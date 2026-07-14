import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AdminOverview,
  AdminSourceHealth,
  AdminSourceHealthGroup,
  SyncRun,
} from '../../types/domain'

const syncMocks = vi.hoisted(() => ({
  fetchOverview: vi.fn(),
  fetchRuns: vi.fn(),
  fetchHealth: vi.fn(),
  groupHealth: vi.fn(),
  triggerAll: vi.fn(),
  retryRun: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}))

vi.mock('../../lib/adminOperations', () => ({
  fetchAdminOverview: syncMocks.fetchOverview,
  fetchAdminSyncRuns: syncMocks.fetchRuns,
  fetchAdminSourceHealth: syncMocks.fetchHealth,
  groupSourceHealth: syncMocks.groupHealth,
  triggerAdminFullSync: syncMocks.triggerAll,
  retryAdminSyncRun: syncMocks.retryRun,
}))

import { AdminSyncPage } from './AdminSyncPage'

const overview: AdminOverview = {
  approvedMemberCount: 8,
  pendingMemberCount: 1,
  failedJobCount24h: 1,
  runningJobCount: 0,
  overdueStatCount: 2,
  credentialErrorCount: 0,
  verifiedAccountCount: 12,
}

const failedRun: SyncRun = {
  id: 12,
  jobId: 10,
  profileId: 'member-1',
  platform: 'qoj',
  memberName: '测试成员',
  status: 'failed',
  jobStatus: 'failed',
  triggerType: 'manual',
  requestedBy: 'admin-1',
  durationMs: 30_000,
  startedAt: '2026-07-13T10:00:00Z',
  finishedAt: '2026-07-13T10:00:30Z',
  errorCode: 'auth_expired',
  errorMessage: '认证过期',
  sourceVersion: 'qoj-browser-v1',
}

const health: AdminSourceHealth[] = [
  {
    platform: 'codeforces',
    totalRuns: 10,
    succeededRuns: 9,
    failedRuns: 1,
    successRate: 90,
    averageDurationMs: 1_500,
    lastSuccessAt: '2026-07-13T10:00:00Z',
    lastFailureAt: '2026-07-13T09:00:00Z',
    latestErrorCode: 'rate_limited',
  },
]

const groupedHealth: AdminSourceHealthGroup[] = [
  {
    id: 'official-api',
    label: '官方 API',
    platforms: ['codeforces', 'atcoder'],
    platformLabel: 'Codeforces / AtCoder',
    totalRuns: 10,
    succeededRuns: 9,
    failedRuns: 1,
    successRate: 90,
    averageDurationMs: 1_500,
    lastSuccessAt: '2026-07-13T10:00:00Z',
    lastFailureAt: '2026-07-13T09:00:00Z',
    latestErrorCode: 'rate_limited',
  },
]

describe('AdminSyncPage with Supabase configured', () => {
  beforeEach(() => {
    syncMocks.fetchOverview.mockReset().mockResolvedValue(overview)
    syncMocks.fetchRuns.mockReset().mockResolvedValue([failedRun])
    syncMocks.fetchHealth.mockReset().mockResolvedValue(health)
    syncMocks.groupHealth.mockReset().mockReturnValue(groupedHealth)
    syncMocks.triggerAll.mockReset().mockResolvedValue({ requested: 8, succeeded: 8, failed: 0 })
    syncMocks.retryRun
      .mockReset()
      .mockResolvedValue({ jobId: 20, memberId: 'member-1', status: 'success' })
  })

  it('confirms the verified account impact before starting a full synchronization', async () => {
    const user = userEvent.setup()
    render(<AdminSyncPage />)

    await screen.findByText('测试成员')
    await user.click(screen.getByRole('button', { name: '同步全部成员' }))

    const dialog = screen.getByRole('dialog', { name: '同步全部成员' })
    expect(within(dialog).getByText('12 个已验证平台账号', { exact: false })).toBeInTheDocument()
    expect(syncMocks.triggerAll).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '确认同步' }))

    expect(syncMocks.triggerAll).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('同步完成，8 个成员成功。')).toBeInTheDocument()
    expect(syncMocks.fetchRuns).toHaveBeenCalledTimes(2)
  })

  it('retries a failed platform run and reloads the live records', async () => {
    const user = userEvent.setup()
    render(<AdminSyncPage />)

    await screen.findByText('测试成员')
    await user.click(screen.getByRole('button', { name: '重试 测试成员 的同步任务' }))

    expect(syncMocks.retryRun).toHaveBeenCalledWith(failedRun)
    expect(await screen.findByText('已重新同步 测试成员 的 qoj 数据。')).toBeInTheDocument()
    expect(syncMocks.fetchRuns).toHaveBeenCalledTimes(2)
  })

  it('shows the persisted synchronization error message', async () => {
    render(<AdminSyncPage />)

    const row = await screen.findByRole('row', { name: /测试成员/ })
    expect(within(row).getByText('auth_expired')).toBeInTheDocument()
    expect(within(row).getByText('认证过期')).toBeInTheDocument()
  })

  it('shows a recoverable empty state when the live center cannot be loaded', async () => {
    syncMocks.fetchRuns.mockRejectedValue(new Error('同步记录读取失败：无权限'))

    render(<AdminSyncPage />)

    expect(await screen.findByText('同步记录读取失败：无权限')).toHaveAttribute('role', 'status')
    expect(screen.getByText('同步中心暂不可用')).toBeInTheDocument()
  })
})
