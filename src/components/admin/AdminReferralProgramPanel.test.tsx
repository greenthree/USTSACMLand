import { render, screen, waitFor, within } from '@testing-library/react'
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
    referralProgramMocks.fetchConfig.mockReset().mockResolvedValue(enabledConfig)
    referralProgramMocks.updateConfig.mockReset().mockResolvedValue(disabledConfig)
  })

  it('loads the global state independently and shows bounded audit metadata', async () => {
    render(<AdminReferralProgramPanel />)

    const region = await screen.findByRole('region', { name: '推荐计划' })
    expect(within(region).getByText('推荐计划正在运行')).toBeInTheDocument()
    expect(within(region).getByText('v7')).toBeInTheDocument()
    expect(within(region).getByText('值班管理员')).toBeInTheDocument()
    expect(within(region).getByText('开放暑期推荐计划')).toBeInTheDocument()
  })

  it('requires an audit reason and explicit confirmation while trapping dialog focus', async () => {
    const user = userEvent.setup()
    render(<AdminReferralProgramPanel />)
    const trigger = await screen.findByRole('button', { name: '关闭推荐计划' })

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '确认关闭推荐计划' })
    const reason = within(dialog).getByRole('textbox', { name: '变更原因' })
    const confirmation = within(dialog).getByRole('checkbox', { name: /我已核对全站影响/ })
    const close = within(dialog).getByRole('button', { name: '关闭推荐计划确认对话框' })
    const submit = within(dialog).getByRole('button', { name: '确认关闭' })

    expect(reason).toHaveFocus()
    expect(submit).toBeDisabled()
    await user.type(reason, '活动结束暂停推荐')
    await user.click(confirmation)
    expect(submit).toBeEnabled()

    close.focus()
    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.click(submit)
    await waitFor(() =>
      expect(referralProgramMocks.updateConfig).toHaveBeenCalledWith(false, 7, '活动结束暂停推荐'),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('推荐计划已全线关闭')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('treats a lost response as success when the reloaded state reached the target', async () => {
    const user = userEvent.setup()
    referralProgramMocks.fetchConfig
      .mockResolvedValueOnce(enabledConfig)
      .mockResolvedValueOnce({ ...disabledConfig, reason: '活动结束 暂停推荐' })
    referralProgramMocks.updateConfig.mockRejectedValue(new Error('网络连接中断'))
    render(<AdminReferralProgramPanel />)

    await user.click(await screen.findByRole('button', { name: '关闭推荐计划' }))
    const dialog = screen.getByRole('dialog', { name: '确认关闭推荐计划' })
    await user.type(
      within(dialog).getByRole('textbox', { name: '变更原因' }),
      '  活动结束   暂停推荐  ',
    )
    await user.click(within(dialog).getByRole('checkbox', { name: /我已核对全站影响/ }))
    await user.click(within(dialog).getByRole('button', { name: '确认关闭' }))

    expect(await screen.findByRole('status')).toHaveTextContent('已通过服务端状态复核')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('推荐计划已暂停')).toBeInTheDocument()
    expect(referralProgramMocks.fetchConfig).toHaveBeenCalledTimes(2)
    expect(referralProgramMocks.updateConfig).toHaveBeenCalledWith(false, 7, '活动结束 暂停推荐')
  })

  it('reloads a conflicting version and requires the administrator to confirm again', async () => {
    const user = userEvent.setup()
    const conflictedConfig = {
      ...enabledConfig,
      version: 8,
      reason: '另一名管理员更新了说明',
    }
    const resolvedConfig = { ...disabledConfig, version: 9 }
    referralProgramMocks.fetchConfig
      .mockResolvedValueOnce(enabledConfig)
      .mockResolvedValueOnce(conflictedConfig)
    referralProgramMocks.updateConfig
      .mockRejectedValueOnce(new Error('配置版本冲突'))
      .mockResolvedValueOnce(resolvedConfig)
    render(<AdminReferralProgramPanel />)

    await user.click(await screen.findByRole('button', { name: '关闭推荐计划' }))
    const dialog = screen.getByRole('dialog', { name: '确认关闭推荐计划' })
    const reason = within(dialog).getByRole('textbox', { name: '变更原因' })
    const confirmation = within(dialog).getByRole('checkbox', { name: /我已核对全站影响/ })
    await user.type(reason, '活动结束暂停推荐')
    await user.click(confirmation)
    await user.click(within(dialog).getByRole('button', { name: '确认关闭' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '已重新加载最新配置（版本 8）',
    )
    expect(confirmation).not.toBeChecked()
    expect(within(dialog).getByRole('button', { name: '确认关闭' })).toBeDisabled()

    await user.click(confirmation)
    await user.click(within(dialog).getByRole('button', { name: '确认关闭' }))
    await waitFor(() =>
      expect(referralProgramMocks.updateConfig).toHaveBeenLastCalledWith(
        false,
        8,
        '活动结束暂停推荐',
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('推荐计划已全线关闭')
  })

  it('does not claim another administrator same-direction change as its own success', async () => {
    const user = userEvent.setup()
    referralProgramMocks.fetchConfig.mockResolvedValueOnce(enabledConfig).mockResolvedValueOnce({
      ...disabledConfig,
      reason: '另一位管理员提前关闭',
    })
    referralProgramMocks.updateConfig.mockRejectedValue(new Error('配置版本冲突'))
    render(<AdminReferralProgramPanel />)

    await user.click(await screen.findByRole('button', { name: '关闭推荐计划' }))
    const dialog = screen.getByRole('dialog', { name: '确认关闭推荐计划' })
    const confirmation = within(dialog).getByRole('checkbox', { name: /我已核对全站影响/ })
    await user.type(within(dialog).getByRole('textbox', { name: '变更原因' }), '活动结束暂停推荐')
    await user.click(confirmation)
    await user.click(within(dialog).getByRole('button', { name: '确认关闭' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('已重新加载最新配置')
    expect(screen.queryByText('已通过服务端状态复核')).not.toBeInTheDocument()
    expect(confirmation).not.toBeChecked()
  })

  it('keeps a local read failure with an independent retry action', async () => {
    const user = userEvent.setup()
    referralProgramMocks.fetchConfig
      .mockRejectedValueOnce(new Error('推荐配置暂不可用'))
      .mockResolvedValueOnce(enabledConfig)
    render(<AdminReferralProgramPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent('推荐配置暂不可用')
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('推荐计划正在运行')).toBeInTheDocument()
    expect(referralProgramMocks.fetchConfig).toHaveBeenCalledTimes(2)
  })
})
