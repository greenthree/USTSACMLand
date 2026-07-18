import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

describe('AdminDailyProblemsPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
  })

  it('lists and filters daily problems with state-appropriate actions', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/admin/daily-problems']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '每日一题管理' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: '后台导航' })).getByRole('link', {
        name: /每日一题/,
      }),
    ).toHaveClass('active')
    expect(
      screen.getByRole('button', { name: /归档题目 二分答案与可行性判断/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /删除草稿 尚未发布的下一题/ })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('题目状态'), 'draft')
    expect(screen.getByText('尚未发布的下一题')).toBeInTheDocument()
    expect(screen.queryByText('二分答案与可行性判断')).not.toBeInTheDocument()
  })

  it('creates a draft with a validated HTTPS source link', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/admin/daily-problems']}>
        <App />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: '新建题目' }))
    await user.type(screen.getByLabelText('题目标题'), '新建训练题')
    await user.type(screen.getByLabelText('平台题号'), '1000A')
    await user.type(
      screen.getByLabelText('原题 HTTPS 链接'),
      'https://codeforces.com/problemset/problem/1000/A',
    )
    await user.type(screen.getByLabelText('难度'), '1200')
    await user.type(screen.getByLabelText('标签（逗号分隔）'), '字符串，模拟')
    await user.type(screen.getByLabelText('训练提示'), '先明确状态，再动手编码。')
    await user.type(screen.getByLabelText('建议用时（分钟）'), '35')
    await user.click(screen.getByRole('button', { name: '保存题目' }))

    expect(await screen.findByText('新建训练题')).toBeInTheDocument()
    expect(screen.getByText('每日一题已创建。')).toBeInTheDocument()
  })
})
