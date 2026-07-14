import LogOut from 'lucide-react/dist/esm/icons/log-out'
import Menu from 'lucide-react/dist/esm/icons/menu'
import X from 'lucide-react/dist/esm/icons/x'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { Brand } from './Brand'

const navItems = [
  { to: '/', label: '首页', end: true },
  { to: '/rankings', label: '榜单', end: false },
]

export function AppShell() {
  const [open, setOpen] = useState(false)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    setOpen(false)
    navigate('/rankings')
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <nav className={open ? 'primary-nav is-open' : 'primary-nav'} aria-label="主导航">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}>
                {item.label}
              </NavLink>
            ))}
            {user ? (
              <NavLink to="/account" onClick={() => setOpen(false)}>
                我的资料
              </NavLink>
            ) : null}
            {user?.role === 'admin' && user.reviewStatus === 'approved' ? (
              <NavLink to="/admin" onClick={() => setOpen(false)}>
                管理后台
              </NavLink>
            ) : null}
            {user ? (
              <button className="logout-button" type="button" onClick={() => void handleSignOut()}>
                <LogOut size={15} aria-hidden="true" />
                退出
              </button>
            ) : (
              <NavLink className="login-link" to="/login" onClick={() => setOpen(false)}>
                登录
              </NavLink>
            )}
          </nav>
          <button
            className="icon-button menu-button"
            type="button"
            aria-label={open ? '关闭导航' : '打开导航'}
            title={open ? '关闭导航' : '打开导航'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>USTS ACM Land</span>
        <span className="site-footer-meta">
          <span>苏州科技大学 ACM 集训队官网</span>
          <NavLink to="/privacy">隐私说明</NavLink>
        </span>
      </footer>
    </div>
  )
}
