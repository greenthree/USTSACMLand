import { act, render, screen, waitFor } from '@testing-library/react'

const referralMocks = vi.hoisted(() => ({
  check: vi.fn(),
}))

vi.mock('../lib/referrals', () => ({
  checkReferralCodeAvailability: referralMocks.check,
}))

import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  beforeEach(() => {
    referralMocks.check.mockReset().mockResolvedValue({
      programEnabled: true,
      available: true,
    })
  })

  it('discloses the closed WebChat boundary, private history retention, and quota metadata', async () => {
    render(<PrivacyPage />)
    await screen.findByRole('heading', { name: '推荐计划' })

    const section = screen.getByRole('heading', { name: '遗留 AI 学习助手数据' }).closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('已经退出当前产品范围')
    expect(section).toHaveTextContent(
      '不再把新的成员问题、会话上下文或固定学习助手指令发送给中转站及其上游模型',
    )
    expect(section).toHaveTextContent('中转站及其上游模型')
    expect(section).toHaveTextContent(
      '会话标题、成员问题和模型可见回复仍保存在 Supabase 私有数据库中',
    )
    expect(section).toHaveTextContent('管理员默认也不能读取其他成员的对话正文')
    expect(section).toHaveTextContent('180 天后自动删除')
    expect(section).toHaveTextContent('当前关闭态不提供会话浏览或单会话删除入口')
    expect(section).toHaveTextContent('登录成员仍可在“我的资料”导出本人历史')
    expect(section).toHaveTextContent('永久注销账号时全部会话和消息随账号级联删除')
    expect(section).not.toHaveTextContent('随时删除单个会话')
    expect(section).toHaveTextContent('不可逆内容指纹')
    expect(section).toHaveTextContent('受当时所选服务及其政策约束')
    expect(section).toHaveTextContent('功能关闭后不再产生新的模型请求')
  })

  it('keeps credentials and private member fields outside the public ranking disclosure', async () => {
    render(<PrivacyPage />)
    await screen.findByRole('heading', { name: '推荐计划' })

    const publicSection = screen.getByRole('heading', { name: '公开范围' }).closest('section')
    expect(publicSection).toHaveTextContent('注册后需先完成邮箱确认，之后才能登录')
    expect(publicSection).not.toHaveTextContent('注册后账号直接启用')
    expect(publicSection).toHaveTextContent('时间范围刷题增量')
    expect(publicSection).toHaveTextContent('邮箱、QQ、密码、登录令牌')
    expect(publicSection).toHaveTextContent('不进入公开榜单')
    expect(publicSection).toHaveTextContent('头像公开地址只使用成员 UUID，不包含 QQ')

    const thirdPartySection = screen.getByRole('heading', { name: '第三方服务' }).closest('section')
    expect(thirdPartySection).toHaveTextContent('只有服务端会把 QQ 号发送给腾讯 QQ 头像接口')
    expect(thirdPartySection).toHaveTextContent('私有存储中保留规范化 WebP 头像和不可逆来源摘要')
  })

  it('shows the current privacy notice date', async () => {
    render(<PrivacyPage />)
    await screen.findByRole('heading', { name: '推荐计划' })

    expect(screen.getByText('更新日期：2026 年 8 月 13 日')).toBeInTheDocument()
  })

  it('documents the target-free personal data export boundary', async () => {
    render(<PrivacyPage />)
    await screen.findByRole('heading', { name: '推荐计划' })

    const section = screen.getByRole('heading', { name: '导出个人数据' }).closest('section')
    expect(section).toHaveTextContent('版本化 JSON')
    expect(section).toHaveTextContent('本人私有的 AI 会话、消息、授权限额和聚合用量')
    expect(section).toHaveTextContent('不接受目标成员 ID')
    expect(section).toHaveTextContent('管理员使用该入口时同样只能导出自己')
    expect(section).toHaveTextContent('本站不会另存一份导出副本')
  })

  it('shows the referral disclosure only after the server confirms the program is enabled', async () => {
    render(<PrivacyPage />)

    expect(screen.queryByRole('heading', { name: '推荐计划' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '推荐计划' })).toBeInTheDocument()
  })

  it('does not reveal the referral program while it is disabled or its state is unavailable', async () => {
    referralMocks.check.mockResolvedValueOnce({ programEnabled: false, available: false })
    const view = render(<PrivacyPage />)

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
    expect(screen.queryByText(/邀请码/)).not.toBeInTheDocument()

    view.unmount()
    referralMocks.check.mockReset().mockRejectedValueOnce(new Error('offline'))
    render(<PrivacyPage />)

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
    expect(screen.queryByText(/邀请码/)).not.toBeInTheDocument()
  })

  it('hides a previously visible referral disclosure as soon as the page regains focus', async () => {
    referralMocks.check
      .mockResolvedValueOnce({ programEnabled: true, available: true })
      .mockResolvedValueOnce({ programEnabled: false, available: false })
    render(<PrivacyPage />)

    expect(await screen.findByRole('heading', { name: '推荐计划' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('focus')))

    await waitFor(() => expect(referralMocks.check).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('推荐计划')).not.toBeInTheDocument()
  })
})
