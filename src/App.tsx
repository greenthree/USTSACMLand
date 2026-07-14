import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAdmin, RequireAuth } from './auth/RouteGuards'
import { AppShell } from './components/AppShell'
import { AdminLayout } from './components/admin/AdminLayout'
import { MembersDataProvider } from './data/MembersDataProvider'
import { AccountPage } from './pages/AccountPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { MemberPage } from './pages/MemberPage'
import { MembersPage } from './pages/MembersPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { RankingsPage } from './pages/RankingsPage'
import { RegisterPage } from './pages/RegisterPage'
import { AdminAuditPage } from './pages/admin/AdminAuditPage'
import { AdminAccountsPage } from './pages/admin/AdminAccountsPage'
import { AdminMemberDetailPage } from './pages/admin/AdminMemberDetailPage'
import { AdminMembersPage } from './pages/admin/AdminMembersPage'
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage'
import { AdminSyncPage } from './pages/admin/AdminSyncPage'

export default function App() {
  return (
    <AuthProvider>
      <MembersDataProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate replace to="/rankings" />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="members/:memberId" element={<MemberPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route
              path="account"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route
              path="admin"
              element={
                <RequireAdmin>
                  <AdminLayout />
                </RequireAdmin>
              }
            >
              <Route index element={<AdminOverviewPage />} />
              <Route path="members" element={<AdminMembersPage />} />
              <Route path="members/:memberId" element={<AdminMemberDetailPage />} />
              <Route path="accounts" element={<AdminAccountsPage />} />
              <Route path="sync" element={<AdminSyncPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate replace to="/rankings" />} />
        </Routes>
      </MembersDataProvider>
    </AuthProvider>
  )
}
