import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AdminOverview,
  AdminSourceHealth,
  AdminSourceHealthGroup,
  SyncQueueJob,
  SyncRun,
} from '../../types/domain'

const syncMocks = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
  fetchOverview: vi.fn(),
  fetchQueue: vi.fn(),
  fetchRuns: vi.fn(),
  fetchHealth: vi.fn(),
  groupHealth: vi.fn(),
  triggerAll: vi.fn(),
  triggerScoped: vi.fn(),
  retryRun: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}))

vi.mock('../../lib/adminOperations', () => ({
  fetchAdminOverview: syncMocks.fetchOverview,
  fetchAdminActiveSyncJobs: syncMocks.fetchQueue,
  fetchAdminSyncRuns: syncMocks.fetchRuns,
  fetchAdminSourceHealth: syncMocks.fetchHealth,
  groupSourceHealth: syncMocks.groupHealth,
  triggerAdminFullSync: syncMocks.triggerAll,
  triggerAdminScopedSync: syncMocks.triggerScoped,
  retryAdminSyncRun: syncMocks.retryRun,
}))

vi.mock('../../lib/adminMembers', () => ({
  fetchAdminMembers: syncMocks.fetchMembers,
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

const members = [
  {
    id: '8a7c4494-97b0-4c5e-a386-02b0efcf22c7',
    name: '测试成员',
    email: 'member@example.test',
    qq: '123456',
    major: '计算机科学与技术',
    grade: '24级',
    status: 'active' as const,
    suspensionNote: null,
    isPublic: true,
    joinedAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-13T00:00:00Z',
    platformCount: 4,
    verifiedPlatformCount: 3,
  },
]

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

const queuedJob: SyncQueueJob = {
  id: 51,
  profileId: 'member-2',
  memberName: '排队成员',
  scope: 'account',
  platform: 'codeforces',
  status: 'queued',
  triggerType: 'scheduled',
  attemptCount: 1,
  maxAttempts: 3,
  scheduledAt: '2026-07-13T10:05:00Z',
  startedAt: null,
  createdAt: '2026-07-13T10:00:00Z',
  errorCode: 'timeout',
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
    syncMocks.fetchMembers.mockReset().mockResolvedValue(members)
    syncMocks.fetchOverview.mockReset().mockResolvedValue(overview)
    syncMocks.fetchQueue.mockReset().mockResolvedValue([queuedJob])
    syncMocks.fetchRuns.mockReset().mockResolvedValue([failedRun])
    syncMocks.fetchHealth.mockReset().mockResolvedValue(health)
    syncMocks.groupHealth.mockReset().mockReturnValue(groupedHealth)
    syncMocks.triggerAll
      .mockReset()
      .mockResolvedValue({ requested: 8, succeeded: 8, queued: 0, failed: 0 })
    syncMocks.triggerScoped
      .mockReset()
      .mockResolvedValue({ requested: 3, succeeded: 3, queued: 0, failed: 0 })
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
    expect(await screen.findByText('同步完成，8 个平台账号成功。')).toBeInTheDocument()
    expect(syncMocks.fetchRuns).toHaveBeenCalledTimes(2)
  })

  it('traps confirmation focus and restores the full-sync trigger after Escape', async () => {
    const user = userEvent.setup()
    render(<AdminSyncPage />)

    await screen.findByText('测试成员')
    const trigger = screen.getByRole('button', { name: '同步全部成员' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '同步全部成员' })
    const cancel = within(dialog).getByRole('button', { name: '取消' })
    const confirm = within(dialog).getByRole('button', { name: '确认同步' })
    expect(cancel).toHaveFocus()

    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
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

  it('confirms and triggers synchronization for one member', async () => {
    const user = userEvent.setup()
    render(<AdminSyncPage />)

    await screen.findByRole('option', { name: '测试成员（3 个账号）' })
    await user.click(screen.getByRole('button', { name: '同步该成员' }))

    const dialog = screen.getByRole('dialog', { name: '同步指定成员' })
    expect(
      within(dialog).getByText('将同步 测试成员 的全部已验证平台账号。', { exact: false }),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '确认同步' }))

    expect(syncMocks.triggerScoped).toHaveBeenCalledWith({
      scope: 'member',
      memberId: '8a7c4494-97b0-4c5e-a386-02b0efcf22c7',
    })
    expect(await screen.findByText('测试成员：同步完成，3 个平台账号成功。')).toBeInTheDocument()
  })

  it('confirms and triggers synchronization for one platform', async () => {
    const user = userEvent.setup()
    render(<AdminSyncPage />)

    await screen.findByRole('option', { name: '测试成员（3 个账号）' })
    await user.selectOptions(screen.getByRole('combobox', { name: '选择同步平台' }), 'luogu')
    await user.click(screen.getByRole('button', { name: '同步该平台' }))

    const dialog = screen.getByRole('dialog', { name: '同步指定平台' })
    expect(
      within(dialog).getByText('将同步所有正常成员的 洛谷 已验证账号。', { exact: false }),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '确认同步' }))

    expect(syncMocks.triggerScoped).toHaveBeenCalledWith({ scope: 'platform', platform: 'luogu' })
    expect(await screen.findByText('洛谷：同步完成，3 个平台账号成功。')).toBeInTheDocument()
  })

  it('reports temporary failures as queued instead of successful', async () => {
    const user = userEvent.setup()
    syncMocks.triggerAll.mockResolvedValueOnce({ requested: 8, succeeded: 7, queued: 1, failed: 0 })
    render(<AdminSyncPage />)

    await screen.findByText('测试成员')
    await user.click(screen.getByRole('button', { name: '同步全部成员' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认同步' }))

    expect(
      await screen.findByText('本轮完成，7 个平台账号成功，1 个已按退避策略加入重试队列。'),
    ).toBeInTheDocument()
  })

  it('shows persisted queue jobs even before a new run exists', async () => {
    render(<AdminSyncPage />)

    const queue = await screen.findByRole('table', { name: '活动同步任务' })
    const row = within(queue).getByRole('row', { name: /排队成员/ })
    expect(within(row).getByText('排队中')).toBeInTheDocument()
    expect(within(row).getByText('1/3')).toBeInTheDocument()
    expect(within(row).getByText('timeout')).toBeInTheDocument()
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
