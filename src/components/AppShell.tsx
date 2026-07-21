import LogOut from 'lucide-react/dist/esm/icons/log-out'
import Menu from 'lucide-react/dist/esm/icons/menu'
import X from 'lucide-react/dist/esm/icons/x'
import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { webChatUiEnabled } from '../features/chat/chatAvailability'
import { Brand } from './Brand'
import { RouteLoading } from './RouteLoading'

const navItems = [
  { to: '/', label: '首页', end: true },
  { to: '/learning', label: '学习', end: false },
  { to: '/daily-problem', label: '每日一题', end: false },
  { to: '/rankings', label: '榜单', end: false },
]

export function AppShell() {
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return undefined

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      menuButtonRef.current?.focus()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  async function handleSignOut() {
    await signOut()
    setOpen(false)
    navigate('/rankings')
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <nav
            id="primary-navigation"
            className={open ? 'primary-nav is-open' : 'primary-nav'}
            aria-label="主导航"
          >
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
            {user ? (
              <NavLink to="/training-goals" onClick={() => setOpen(false)}>
                训练目标
              </NavLink>
            ) : null}
            {webChatUiEnabled && user ? (
              <NavLink to="/assistant" onClick={() => setOpen(false)}>
                AI 助手
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
            ref={menuButtonRef}
            className="icon-button menu-button"
            type="button"
            aria-label={open ? '关闭导航' : '打开导航'}
            aria-expanded={open}
            aria-controls="primary-navigation"
            title={open ? '关闭导航' : '打开导航'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
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
