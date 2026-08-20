import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const referralProgramMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock('../../lib/adminReferralProgram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adminReferralProgram')>()),
  fetchAdminReferralProgramConfig: referralProgramMocks.fetchConfig,
  updateAdminReferralProgramConfig: referralProgramMocks.updateConfig,
}))

import { AdminReferralProgramPanel } from './AdminReferralProgramPanel'

const enabledConfig = {
  enabled: true,
  version: 7,
  updatedAt: '2026-07-22T08:00:00Z',
  updatedByLabel: '值班管理员',
  reason: '开放暑期推荐计划',
}

const disabledConfig = {
  ...enabledConfig,
  enabled: false,
  version: 8,
  updatedAt: '2026-07-22T09:00:00Z',
  reason: '活动结束暂停推荐',
}

describe('AdminReferralProgramPanel', () => {
  beforeEach(() => {
    referralProgramMocks.fetchConfig.mockReset().mockResolvedValue(disabledConfig)
    referralProgramMocks.updateConfig.mockReset().mockResolvedValue(disabledConfig)
  })

  it('loads the global state and renders read-only closed status with audit metadata', async () => {
    render(<AdminReferralProgramPanel />)

    const region = await screen.findByRole('region', { name: '推荐计划' })
    expect(within(region).getByText('只读关闭')).toBeInTheDocument()
    expect(within(region).getByText('推荐计划已永久关闭')).toBeInTheDocument()
    expect(within(region).getByText('v8')).toBeInTheDocument()
    expect(within(region).getByText('值班管理员')).toBeInTheDocument()
    expect(within(region).getByText('活动结束暂停推荐')).toBeInTheDocument()

    // 断言无开启/关闭按钮与无更新调用
    expect(within(region).queryByRole('button', { name: /开启/ })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /关闭/ })).not.toBeInTheDocument()
    expect(within(region).queryByRole('dialog')).not.toBeInTheDocument()
    expect(referralProgramMocks.updateConfig).not.toHaveBeenCalled()
  })

  it('renders legacy enabled values as retired closed status without mutation controls', async () => {
    referralProgramMocks.fetchConfig.mockResolvedValueOnce(enabledConfig)
    render(<AdminReferralProgramPanel />)

    const region = await screen.findByRole('region', { name: '推荐计划' })
    expect(within(region).getByText('只读关闭（遗留值开启）')).toBeInTheDocument()
    expect(within(region).getByText('推荐计划已废弃关闭')).toBeInTheDocument()
    expect(within(region).getByText('v7')).toBeInTheDocument()

    // 即使历史数据库值为 enabled，面板仍为只读关闭，不提供开启/关闭按钮
    expect(within(region).queryByRole('button', { name: /开启/ })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /关闭/ })).not.toBeInTheDocument()
    expect(referralProgramMocks.updateConfig).not.toHaveBeenCalled()
  })

  it('refreshes the read-only state via the refresh button without making mutation calls', async () => {
    const user = userEvent.setup()
    referralProgramMocks.fetchConfig
      .mockResolvedValueOnce(disabledConfig)
      .mockResolvedValueOnce({ ...disabledConfig, version: 9 })
    render(<AdminReferralProgramPanel />)

    expect(await screen.findByText('v8')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '刷新状态' }))

    expect(await screen.findByText('v9')).toBeInTheDocument()
    expect(referralProgramMocks.fetchConfig).toHaveBeenCalledTimes(2)
    expect(referralProgramMocks.updateConfig).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /开启/ })).not.toBeInTheDocument()
  })

  it('keeps a local read failure with an independent retry action without making mutation calls', async () => {
    const user = userEvent.setup()
    referralProgramMocks.fetchConfig
      .mockRejectedValueOnce(new Error('推荐配置暂不可用'))
      .mockResolvedValueOnce(disabledConfig)
    render(<AdminReferralProgramPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent('推荐配置暂不可用')
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('推荐计划已永久关闭')).toBeInTheDocument()
    expect(referralProgramMocks.fetchConfig).toHaveBeenCalledTimes(2)
    expect(referralProgramMocks.updateConfig).not.toHaveBeenCalled()
  })
})
