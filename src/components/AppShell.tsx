import BookOpen from 'lucide-react/dist/esm/icons/book-open'
import CalendarCheck2 from 'lucide-react/dist/esm/icons/calendar-check-2'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import LogOut from 'lucide-react/dist/esm/icons/log-out'
import Menu from 'lucide-react/dist/esm/icons/menu'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import Target from 'lucide-react/dist/esm/icons/target'
import UserRound from 'lucide-react/dist/esm/icons/user-round'
import X from 'lucide-react/dist/esm/icons/x'
import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { webChatUiEnabled } from '../features/chat/chatAvailability'
import { Brand } from './Brand'
import { RouteLoading } from './RouteLoading'

const learningItems = [
  { to: '/learning', label: '新手入门', description: '学习路线与入门资源', icon: BookOpen },
  { to: '/training-goals', label: '训练目标', description: '记录阶段目标与进度', icon: Target },
  {
    to: '/daily-problem',
    label: '每日一题',
    description: '今天也从一道题开始',
    icon: CalendarCheck2,
  },
]

export function AppShell() {
  const [open, setOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<'learning' | 'account' | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const learningButtonRef = useRef<HTMLButtonElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const learningActive = learningItems.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  )
  const accountActive = location.pathname === '/account' || location.pathname.startsWith('/admin')

  useEffect(() => {
    if (!open && openGroup === null) return undefined

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (openGroup !== null) {
        const trigger =
          openGroup === 'learning' ? learningButtonRef.current : accountButtonRef.current
        setOpenGroup(null)
        trigger?.focus()
        return
      }
      setOpen(false)
      menuButtonRef.current?.focus()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open, openGroup])

  useEffect(() => {
    if (openGroup === null) return undefined

    function closeOutsideNavigation(event: PointerEvent) {
      if (navigationRef.current?.contains(event.target as Node)) return
      setOpenGroup(null)
    }

    document.addEventListener('pointerdown', closeOutsideNavigation)
    return () => document.removeEventListener('pointerdown', closeOutsideNavigation)
  }, [openGroup])

  useEffect(() => {
    setOpen(false)
    setOpenGroup(null)
  }, [location.pathname])

  function closeNavigation() {
    setOpen(false)
    setOpenGroup(null)
  }

  async function handleSignOut() {
    await signOut()
    closeNavigation()
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
            ref={navigationRef}
            id="primary-navigation"
            className={open ? 'primary-nav is-open' : 'primary-nav'}
            aria-label="主导航"
          >
            <NavLink className="primary-nav-link" to="/" end onClick={closeNavigation}>
              首页
            </NavLink>
            <div className={`nav-group nav-learning${openGroup === 'learning' ? ' is-open' : ''}`}>
              <button
                ref={learningButtonRef}
                className={`nav-group-trigger${learningActive ? ' is-current' : ''}`}
                type="button"
                aria-expanded={openGroup === 'learning'}
                aria-controls="learning-navigation"
                onClick={() =>
                  setOpenGroup((current) => (current === 'learning' ? null : 'learning'))
                }
              >
                <BookOpen size={15} aria-hidden="true" />
                学习
                <ChevronDown className="nav-chevron" size={14} aria-hidden="true" />
              </button>
              {openGroup === 'learning' ? (
                <div
                  id="learning-navigation"
                  className="nav-dropdown"
                  role="group"
                  aria-label="学习导航"
                >
                  {learningItems.map((item) => {
                    if (item.to === '/training-goals' && !user) return null
                    const Icon = item.icon
                    return (
                      <NavLink key={item.to} to={item.to} onClick={closeNavigation}>
                        <Icon size={16} aria-hidden="true" />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                      </NavLink>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <NavLink className="primary-nav-link" to="/rankings" onClick={closeNavigation}>
              榜单
            </NavLink>
            {webChatUiEnabled && user ? (
              <NavLink className="primary-nav-link" to="/assistant" onClick={closeNavigation}>
                AI 助手
              </NavLink>
            ) : null}
            {user ? (
              <div className={`nav-group nav-account${openGroup === 'account' ? ' is-open' : ''}`}>
                <button
                  ref={accountButtonRef}
                  className={`nav-group-trigger${accountActive ? ' is-current' : ''}`}
                  type="button"
                  aria-expanded={openGroup === 'account'}
                  aria-controls="account-navigation"
                  onClick={() =>
                    setOpenGroup((current) => (current === 'account' ? null : 'account'))
                  }
                >
                  <UserRound size={16} aria-hidden="true" />
                  我的账号
                  <ChevronDown className="nav-chevron" size={14} aria-hidden="true" />
                </button>
                {openGroup === 'account' ? (
                  <div
                    id="account-navigation"
                    className="nav-dropdown"
                    role="group"
                    aria-label="账号导航"
                  >
                    <p className="nav-account-identity" title={user.email}>
                      {user.email}
                    </p>
                    <NavLink to="/account" onClick={closeNavigation}>
                      <UserRound size={16} aria-hidden="true" />
                      <span>
                        <strong>我的资料</strong>
                        <small>资料、平台账号与数据</small>
                      </span>
                    </NavLink>
                    {user.role === 'admin' && user.reviewStatus === 'approved' ? (
                      <NavLink to="/admin" onClick={closeNavigation}>
                        <ShieldCheck size={16} aria-hidden="true" />
                        <span>
                          <strong>管理后台</strong>
                          <small>成员与站点管理</small>
                        </span>
                      </NavLink>
                    ) : null}
                    <button
                      className="logout-button"
                      type="button"
                      onClick={() => void handleSignOut()}
                    >
                      <LogOut size={16} aria-hidden="true" />
                      <span>
                        <strong>退出登录</strong>
                        <small>结束当前账号会话</small>
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <NavLink className="login-link" to="/login" onClick={closeNavigation}>
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
            onClick={() => {
              setOpenGroup(null)
              setOpen((value) => !value)
            }}
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
