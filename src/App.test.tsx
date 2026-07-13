import { render, screen } from '@testing-library/react'
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

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument()
  })

  it('redirects ordinary members away from the admin area', async () => {
    sessionStorage.setItem(demoSessionKey, 'member@example.edu.cn')
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Rating 榜' })).toBeInTheDocument()
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

  it('keeps the privacy notice public', async () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '隐私说明' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '公开范围' })).toBeInTheDocument()
  })
})
