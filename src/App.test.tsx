import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

describe('route authorization', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('redirects anonymous visitors from the admin area to login', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'USTS ACM Land' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: '登录' }, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('redirects ordinary members away from the admin area', async () => {
    sessionStorage.setItem(demoSessionKey, 'member@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Rating 榜' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '管理概览' })).not.toBeInTheDocument()
  })

  it('allows approved demo administrators into the admin area', async () => {
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '后台概览' })).toBeInTheDocument()
  })

  it('exposes member management to approved demo administrators', async () => {
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin/members']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '成员管理' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '成员审核' })).not.toBeInTheDocument()
  })

  it('exposes member detail management to approved demo administrators', async () => {
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin/members/member-1']}>
        <App />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '沈亦安' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '平台账号与数据' })).toBeInTheDocument()
  })

  it('exposes the data source health page to approved demo administrators', async () => {
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin/health']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '数据源健康' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '平台健康列表' })).toBeInTheDocument()
  })

  it('exposes announcement management to approved demo administrators', async () => {
    sessionStorage.setItem(demoSessionKey, 'admin@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin/announcements']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '公告管理' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /公告管理/ })).toHaveClass('active')
  })

  it('keeps the privacy notice public', async () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '隐私说明' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '公开范围' })).toBeInTheDocument()
    expect(screen.getByText(/普通成员可在账号页再次验证当前密码/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '第三方数据来源说明' })).toHaveAttribute(
      'href',
      'https://github.com/greenthree/USTSACMLand/blob/main/docs/third-party-data-sources.md',
    )
  })

  it('exposes a skip link and moves route focus after client-side navigation', async () => {
    const user = userEvent.setup()
    document.documentElement.scrollTop = 500
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    const main = await screen.findByRole('main')
    expect(screen.getByRole('link', { name: '跳转到主要内容' })).toHaveAttribute(
      'href',
      '#main-content',
    )
    expect(main).toHaveAttribute('id', 'main-content')
    await user.click(screen.getByRole('link', { name: '榜单' }))
    await waitFor(() => expect(main).toHaveFocus())
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.title).toBe('榜单 | USTS ACM Land')
    expect(screen.getByText('已进入榜单页面')).toHaveAttribute('role', 'status')
  })

  it('closes the mobile navigation with Escape and restores menu-button focus', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    const menuButton = await screen.findByRole('button', { name: '打开导航' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveAttribute('aria-controls', 'primary-navigation')

    await user.click(menuButton)
    expect(screen.getByRole('button', { name: '关闭导航' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '打开导航' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(menuButton).toHaveFocus()
  })

  it('wraps authentication routes in a focusable main landmark', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    const main = await screen.findByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    expect(document.title).toBe('登录 | USTS ACM Land')
  })
})
