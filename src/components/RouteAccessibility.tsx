import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const SITE_TITLE = 'USTS ACM Land'

function pageTitle(pathname: string): string {
  if (pathname === '/') return '苏州科技大学 ACM 集训队官网'
  if (pathname === '/rankings') return '榜单'
  if (pathname === '/members') return '成员'
  if (pathname.startsWith('/members/')) return '成员详情'
  if (pathname === '/privacy') return '隐私说明'
  if (pathname === '/login') return '登录'
  if (pathname === '/register') return '创建账号'
  if (pathname === '/forgot-password') return '找回密码'
  if (pathname === '/reset-password') return '设置新密码'
  if (pathname === '/account') return '我的资料'
  if (pathname === '/admin/members') return '成员管理'
  if (pathname.startsWith('/admin/members/')) return '成员详情管理'
  if (pathname === '/admin/accounts') return '平台绑定管理'
  if (pathname === '/admin/announcements') return '公告管理'
  if (pathname === '/admin/sync') return '同步中心'
  if (pathname === '/admin/health') return '数据源健康'
  if (pathname === '/admin/audit') return '审计日志'
  if (pathname === '/admin') return '管理后台'
  return SITE_TITLE
}

export function RouteAccessibility() {
  const { pathname } = useLocation()
  const title = pageTitle(pathname)
  const previousPathname = useRef(pathname)

  useEffect(() => {
    document.title = pathname === '/' ? `${SITE_TITLE} | ${title}` : `${title} | ${SITE_TITLE}`
    if (previousPathname.current === pathname) return

    previousPathname.current = pathname
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
  }, [pathname, title])

  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      已进入{title}页面
    </span>
  )
}
