import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const pilotPanelMocks = vi.hoisted(() => ({ fetchMembers: vi.fn() }))

vi.mock('../../lib/adminWebChatPilot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adminWebChatPilot')>()),
  fetchAdminWebChatPilotMembers: pilotPanelMocks.fetchMembers,
}))

import { AdminWebChatPilotPanel } from './AdminWebChatPilotPanel'

const members = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: '测试成员',
    grade: '24级',
    major: '计算机科学与技术',
    role: 'member' as const,
    accountStatus: 'approved' as const,
    accessEnabled: true,
    dailyRequestLimit: 20,
    dailyTokenLimit: 80_000,
    usageDate: '2026-07-18',
    requestCount: 6,
    settledTokens: 12_000,
    reservedTokens: 3_000,
    remainingRequests: 14,
    remainingTokens: 65_000,
    activeRequestCount: 1,
    lastRequestAt: '2026-07-18T08:00:00Z',
    version: 2,
    updatedAt: '2026-07-17T12:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: '停用管理员',
    grade: null,
    major: null,
    role: 'admin' as const,
    accountStatus: 'suspended' as const,
    accessEnabled: false,
    dailyRequestLimit: 10,
    dailyTokenLimit: 20_000,
    usageDate: '2026-07-18',
    requestCount: 0,
    settledTokens: 0,
    reservedTokens: 0,
    remainingRequests: 10,
    remainingTokens: 20_000,
    activeRequestCount: 0,
    lastRequestAt: null,
    version: 3,
    updatedAt: '2026-07-18T01:00:00Z',
  },
]

function renderPanel() {
  return render(
    <MemoryRouter>
      <AdminWebChatPilotPanel />
    </MemoryRouter>,
  )
}

describe('AdminWebChatPilotPanel', () => {
  beforeEach(() => pilotPanelMocks.fetchMembers.mockReset().mockResolvedValue(members))

  it('summarizes configured pilot accounts and shows bounded per-member usage', async () => {
    renderPanel()

    const region = await screen.findByRole('region', { name: '试运行成员' })
    const summary = within(region).getByLabelText('试运行摘要')
    expect(within(summary).getByText('已配置账号').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('当前可用').nextSibling).toHaveTextContent('1')
    expect(within(summary).getByText('今日占用 Token').nextSibling).toHaveTextContent('15,000')
    expect(within(region).getByText('6 / 20')).toBeInTheDocument()
    expect(within(region).getByText(/已结算 12,000 · 预留 3,000 · 剩余 65,000/)).toBeInTheDocument()
    expect(within(region).getByText(/账号已停用/)).toBeInTheDocument()
    expect(within(region).getAllByRole('link', { name: '查看详情' })[0]).toHaveAttribute(
      'href',
      `/admin/members/${members[0].id}`,
    )
  })

  it('keeps a local error with an independent retry action', async () => {
    const user = userEvent.setup()
    pilotPanelMocks.fetchMembers
      .mockRejectedValueOnce(new Error('试运行观测暂时不可用'))
      .mockResolvedValueOnce(members)
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('试运行观测暂时不可用')
    await user.click(screen.getByRole('button', { name: '重试观测数据' }))

    expect(await screen.findByText('测试成员')).toBeInTheDocument()
    expect(pilotPanelMocks.fetchMembers).toHaveBeenCalledTimes(2)
  })

  it('explains how to create the initial 3–5 member pilot roster', async () => {
    pilotPanelMocks.fetchMembers.mockResolvedValue([])
    renderPanel()

    expect(await screen.findByText('尚未配置试运行成员')).toBeInTheDocument()
    expect(screen.getByText(/3–5 名成员/)).toBeInTheDocument()
  })
})
