import { Navigate, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/LoadingState'
import { useAuth } from './authContextValue'

function GuardLoading() {
  return (
    <div className="page narrow-page">
      <LoadingState label="正在验证账号权限" />
    </div>
  )
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <GuardLoading />
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate replace to={`/login?returnTo=${encodeURIComponent(returnTo)}`} />
  }
  return children
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <GuardLoading />
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate replace to={`/login?returnTo=${encodeURIComponent(returnTo)}`} />
  }
  if (user.role !== 'admin' || user.reviewStatus !== 'approved') {
    return <Navigate replace to="/rankings" />
  }
  return children
}
