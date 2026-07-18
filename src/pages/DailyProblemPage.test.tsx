import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

describe('DailyProblemPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('keeps the problem public and preserves returnTo for anonymous participation', async () => {
    render(
      <MemoryRouter initialEntries={['/daily-problem']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '二分答案与可行性判断' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开原题' })).toHaveAttribute(
      'href',
      'https://codeforces.com/problemset/problem/1201/C',
    )
    expect(screen.getByRole('link', { name: '登录后参与' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fdaily-problem',
    )
    expect(screen.queryByRole('button', { name: '标记为已完成' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('写下你的突破点或易错点')).not.toBeInTheDocument()
    expect(document.title).toBe('每日一题 | USTS ACM Land')
  })

  it('lets an approved member record completion and publish plain-text discussion', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(demoSessionKey, 'member@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/daily-problem']}>
        <App />
      </MemoryRouter>,
    )

    const completion = await screen.findByRole(
      'button',
      { name: '标记为已完成' },
      { timeout: 5000 },
    )
    await user.click(completion)
    expect(screen.getByRole('button', { name: '今天已完成' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const discussion = screen.getByRole('region', { name: '交换关键思路' })
    const payload = '<img src=x onerror=alert(1)>'
    await user.type(within(discussion).getByLabelText('写下你的突破点或易错点'), payload)
    await user.click(within(discussion).getByRole('button', { name: '发布讨论' }))
    expect(within(discussion).getByText(payload)).toBeInTheDocument()
    expect(discussion.querySelector('img')).toBeNull()
  })

  it('exposes dated archive links and a visible completed-history marker', async () => {
    sessionStorage.setItem(demoSessionKey, 'member@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/daily-problem']}>
        <App />
      </MemoryRouter>,
    )

    const archive = await screen.findByRole('complementary', {
      name: '最近题目',
    })
    expect(within(archive).getByText(/AtCoder · 已完成/)).toBeInTheDocument()
    expect(within(archive).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/daily-problem\/\d{4}-\d{2}-\d{2}$/),
    )
  })

  it('lets an administrator hide another member discussion without deleting it', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/daily-problem']}>
        <App />
      </MemoryRouter>,
    )

    const discussion = await screen.findByRole('region', { name: '交换关键思路' })
    const comment = within(discussion).getByText(
      '把中位数左边的数忽略掉后，判断函数会更容易写清楚。',
    )
    const item = comment.closest('li')
    expect(item).not.toBeNull()
    await user.click(within(item!).getByRole('button', { name: '隐藏' }))
    await user.type(within(item!).getByLabelText('管理原因'), '包含过多题解细节。')
    await user.click(within(item!).getByRole('button', { name: '确认隐藏' }))

    expect(within(item!).getByText('已隐藏')).toBeInTheDocument()
    expect(within(discussion).getByText('讨论已隐藏。')).toBeInTheDocument()
    expect(comment).toBeInTheDocument()
  })
})
