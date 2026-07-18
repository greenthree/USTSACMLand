import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check'
import FileClock from 'lucide-react/dist/esm/icons/file-clock'
import CalendarCheck2 from 'lucide-react/dist/esm/icons/calendar-check-2'
import Gauge from 'lucide-react/dist/esm/icons/gauge'
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse'
import IdCard from 'lucide-react/dist/esm/icons/id-card'
import Megaphone from 'lucide-react/dist/esm/icons/megaphone'
import MessageSquareLock from 'lucide-react/dist/esm/icons/message-square-lock'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Users from 'lucide-react/dist/esm/icons/users'
import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { RouteLoading } from '../RouteLoading'

const adminItems = [
  { to: '/admin', label: '概览', icon: Gauge, end: true },
  { to: '/admin/members', label: '成员管理', icon: Users },
  { to: '/admin/accounts', label: '平台账号', icon: IdCard },
  { to: '/admin/announcements', label: '公告管理', icon: Megaphone },
  { to: '/admin/daily-problems', label: '每日一题', icon: CalendarCheck2 },
  { to: '/admin/sync', label: '同步中心', icon: RefreshCw },
  { to: '/admin/health', label: '数据源健康', icon: HeartPulse },
  { to: '/admin/webchat', label: 'WebChat 配置', icon: MessageSquareLock },
  { to: '/admin/audit', label: '审计日志', icon: FileClock },
]

export function AdminLayout() {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-heading">
          <ClipboardCheck size={19} aria-hidden="true" />
          <span>管理后台</span>
        </div>
        <nav aria-label="后台导航">
          {adminItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>
      <div className="admin-content">
        <Suspense fallback={<RouteLoading label="正在加载后台页面" />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
