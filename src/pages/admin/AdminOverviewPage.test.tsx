import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AdminOverview, ReviewMember, SyncRun } from '../../types/domain'

const overviewMocks = vi.hoisted(() => ({
  fetchOverview: vi.fn(),
  fetchMembers: vi.fn(),
  fetchRuns: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminMembers', () => ({
  fetchAdminReviewMembers: overviewMocks.fetchMembers,
}))

vi.mock('../../lib/adminOperations', () => ({
  fetchAdminOverview: overviewMocks.fetchOverview,
  fetchAdminSyncRuns: overviewMocks.fetchRuns,
}))

import { AdminOverviewPage } from './AdminOverviewPage'

const overview: AdminOverview = {
  approvedMemberCount: 8,
  pendingMemberCount: 1,
  failedJobCount24h: 2,
  runningJobCount: 0,
  overdueStatCount: 3,
  credentialErrorCount: 0,
  verifiedAccountCount: 20,
}

const pendingMember: ReviewMember = {
  id: 'member-1',
  name: '测试成员',
  major: '计算机科学与技术',
  grade: '24级',
  qq: '123456789',
  email: 'member@example.edu.cn',
  submittedAt: '2026-07-13T10:00:00Z',
  updatedAt: '2026-07-13T10:00:00Z',
  reviewStatus: 'pending',
  reviewNote: null,
  platformCount: 4,
}

const recentRun: SyncRun = {
  id: 9,
  jobId: 7,
  profileId: 'member-1',
  platform: 'codeforces',
  memberName: '测试成员',
  status: 'success',
  jobStatus: 'succeeded',
  triggerType: 'manual',
  requestedBy: 'admin-1',
  durationMs: 1800,
  startedAt: '2026-07-13T10:00:00Z',
  finishedAt: '2026-07-13T10:00:01Z',
  errorCode: null,
  errorMessage: null,
  sourceVersion: 'test-v1',
}

describe('AdminOverviewPage with Supabase configured', () => {
  beforeEach(() => {
    overviewMocks.fetchOverview.mockReset()
    overviewMocks.fetchMembers.mockReset()
    overviewMocks.fetchRuns.mockReset()
  })

  it('loads metrics, pending members, and recent runs from live sources', async () => {
    overviewMocks.fetchOverview.mockResolvedValue(overview)
    overviewMocks.fetchMembers.mockResolvedValue([pendingMember])
    overviewMocks.fetchRuns.mockResolvedValue([recentRun])

    render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('实时数据')).toBeInTheDocument()
    expect(await screen.findAllByText('测试成员')).toHaveLength(2)
    expect(
      within(screen.getByRole('row', { name: /测试成员 24级/ })).getByText('24级'),
    ).toBeInTheDocument()
    expect(screen.getByText('24 小时失败任务')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(overviewMocks.fetchRuns).toHaveBeenCalledWith(5)
  })

  it('does not replace a live loading failure with demo metrics', async () => {
    overviewMocks.fetchOverview.mockRejectedValue(new Error('后台概览读取失败：无权限'))
    overviewMocks.fetchMembers.mockResolvedValue([])
    overviewMocks.fetchRuns.mockResolvedValue([])

    render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('后台概览读取失败：无权限')).toHaveAttribute('role', 'status')
    expect(screen.getByText('概览数据暂不可用')).toBeInTheDocument()
    expect(screen.queryByText('已审核成员')).not.toBeInTheDocument()
  })
})
