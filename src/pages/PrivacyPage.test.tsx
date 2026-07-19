import { render, screen } from '@testing-library/react'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('discloses WebChat relay processing, private history retention, and quota metadata', () => {
    render(<PrivacyPage />)

    const section = screen.getByRole('heading', { name: 'AI 学习助手' }).closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('中转站及其上游模型')
    expect(section).toHaveTextContent('Supabase 私有数据库中保存会话标题、成员问题和模型可见回复')
    expect(section).toHaveTextContent('管理员默认也不能读取其他成员的对话正文')
    expect(section).toHaveTextContent('180 天后自动删除')
    expect(section).toHaveTextContent('不可逆内容指纹')
    expect(section).toHaveTextContent('受管理员最终选择的服务和该服务政策约束')
    expect(section).toHaveTextContent('持续核对真实中转站的数据政策')
  })

  it('keeps credentials and private member fields outside the public ranking disclosure', () => {
    render(<PrivacyPage />)

    const publicSection = screen.getByRole('heading', { name: '公开范围' }).closest('section')
    expect(publicSection).toHaveTextContent('时间范围刷题增量')
    expect(publicSection).toHaveTextContent('邮箱、QQ、密码、登录令牌')
    expect(publicSection).toHaveTextContent('不进入公开榜单')
  })

  it('documents the target-free personal data export boundary', () => {
    render(<PrivacyPage />)

    const section = screen.getByRole('heading', { name: '导出个人数据' }).closest('section')
    expect(section).toHaveTextContent('版本化 JSON')
    expect(section).toHaveTextContent('本人私有的 AI 会话、消息、授权限额和聚合用量')
    expect(section).toHaveTextContent('不接受目标成员 ID')
    expect(section).toHaveTextContent('管理员使用该入口时同样只能导出自己')
    expect(section).toHaveTextContent('本站不会另存一份导出副本')
  })
})
