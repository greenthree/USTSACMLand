import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check'
import FileClock from 'lucide-react/dist/esm/icons/file-clock'
import Gauge from 'lucide-react/dist/esm/icons/gauge'
import IdCard from 'lucide-react/dist/esm/icons/id-card'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import { NavLink, Outlet } from 'react-router-dom'

const adminItems = [
  { to: '/admin', label: '概览', icon: Gauge, end: true },
  { to: '/admin/accounts', label: '平台账号', icon: IdCard },
  { to: '/admin/sync', label: '同步中心', icon: RefreshCw },
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
        <Outlet />
      </div>
    </div>
  )
}
