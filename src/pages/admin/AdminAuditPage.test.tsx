import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuditEntry } from '../../types/domain'

const auditMocks = vi.hoisted(() => ({
  fetchEntries: vi.fn(),
  buildCsv: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminOperations', () => ({
  fetchAdminAuditEntries: auditMocks.fetchEntries,
  buildAuditCsv: auditMocks.buildCsv,
}))

import { AdminAuditPage } from './AdminAuditPage'

const auditEntry: AuditEntry = {
  id: 7,
  actorId: 'admin-1',
  actor: '测试管理员',
  action: '启用成员',
  targetTable: 'profiles',
  targetId: 'member-1',
  target: '测试成员',
  createdAt: '2026-07-13T10:00:00Z',
  summary: '成员状态：待启用 -> 已启用',
}

describe('AdminAuditPage with Supabase configured', () => {
  beforeEach(() => {
    auditMocks.fetchEntries.mockReset()
    auditMocks.buildCsv.mockReset().mockReturnValue('actor,action\r\n')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:audit'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads live audit entries and exports the displayed sanitized rows', async () => {
    const user = userEvent.setup()
    auditMocks.fetchEntries.mockResolvedValue([auditEntry])

    render(<AdminAuditPage />)

    expect(screen.getByText('实时数据')).toBeInTheDocument()
    expect(await screen.findByText('测试管理员')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '导出 CSV' }))

    expect(auditMocks.buildCsv).toHaveBeenCalledWith([auditEntry])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audit')
  })

  it('disables export and shows an empty state when there are no logs', async () => {
    auditMocks.fetchEntries.mockResolvedValue([])

    render(<AdminAuditPage />)

    expect(await screen.findByText('暂无审计日志')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled()
  })

  it('shows the live loading error without falling back to demo entries', async () => {
    auditMocks.fetchEntries.mockRejectedValue(new Error('审计日志读取失败：无权限'))

    render(<AdminAuditPage />)

    expect(await screen.findByText('审计日志读取失败：无权限')).toHaveAttribute('role', 'status')
    expect(screen.getByText('暂无审计日志')).toBeInTheDocument()
    expect(screen.queryByText('管理员')).not.toBeInTheDocument()
  })
})
