import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAdmin, RequireAuth } from './auth/RouteGuards'
import { AppShell } from './components/AppShell'
import { RouteAccessibility } from './components/RouteAccessibility'
import { StandaloneRouteLoading } from './components/RouteLoading'
import { AdminLayout } from './components/admin/AdminLayout'
import { MembersDataProvider } from './data/MembersDataProvider'
import { webChatUiEnabled } from './features/chat/chatAvailability'

const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((module) => ({ default: module.AccountPage })),
)
const AssistantPage = lazy(() =>
  import('./pages/AssistantPage').then((module) => ({ default: module.AssistantPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((module) => ({
    default: module.ForgotPasswordPage,
  })),
)
const HomePage = lazy(() =>
  import('./pages/HomePage').then((module) => ({ default: module.HomePage })),
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
)
const LearningPage = lazy(() =>
  import('./pages/LearningPage').then((module) => ({ default: module.LearningPage })),
)
const MemberPage = lazy(() =>
  import('./pages/MemberPage').then((module) => ({ default: module.MemberPage })),
)
const MembersPage = lazy(() =>
  import('./pages/MembersPage').then((module) => ({ default: module.MembersPage })),
)
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })),
)
const RankingsPage = lazy(() =>
  import('./pages/RankingsPage').then((module) => ({ default: module.RankingsPage })),
)
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((module) => ({ default: module.RegisterPage })),
)
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((module) => ({
    default: module.ResetPasswordPage,
  })),
)
const AdminAuditPage = lazy(() =>
  import('./pages/admin/AdminAuditPage').then((module) => ({ default: module.AdminAuditPage })),
)
const AdminAccountsPage = lazy(() =>
  import('./pages/admin/AdminAccountsPage').then((module) => ({
    default: module.AdminAccountsPage,
  })),
)
const AdminAnnouncementsPage = lazy(() =>
  import('./pages/admin/AdminAnnouncementsPage').then((module) => ({
    default: module.AdminAnnouncementsPage,
  })),
)
const AdminMemberDetailPage = lazy(() =>
  import('./pages/admin/AdminMemberDetailPage').then((module) => ({
    default: module.AdminMemberDetailPage,
  })),
)
const AdminMembersPage = lazy(() =>
  import('./pages/admin/AdminMembersPage').then((module) => ({
    default: module.AdminMembersPage,
  })),
)
const AdminOverviewPage = lazy(() =>
  import('./pages/admin/AdminOverviewPage').then((module) => ({
    default: module.AdminOverviewPage,
  })),
)
const AdminSourceHealthPage = lazy(() =>
  import('./pages/admin/AdminSourceHealthPage').then((module) => ({
    default: module.AdminSourceHealthPage,
  })),
)
const AdminSyncPage = lazy(() =>
  import('./pages/admin/AdminSyncPage').then((module) => ({ default: module.AdminSyncPage })),
)
const AdminWebChatPage = lazy(() =>
  import('./pages/admin/AdminWebChatPage').then((module) => ({
    default: module.AdminWebChatPage,
  })),
)

function PublicMembersOutlet() {
  return (
    <MembersDataProvider>
      <Outlet />
    </MembersDataProvider>
  )
}

function WebChatRoute({ children }: { children: React.ReactNode }) {
  if (!webChatUiEnabled) return <Navigate replace to="/" />
  return <RequireAuth>{children}</RequireAuth>
}

export default function App() {
  return (
    <AuthProvider>
      <RouteAccessibility />
      <Suspense fallback={<StandaloneRouteLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<AppShell />}>
            <Route element={<PublicMembersOutlet />}>
              <Route index element={<HomePage />} />
              <Route path="rankings" element={<RankingsPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="members/:memberId" element={<MemberPage />} />
            </Route>
            <Route path="learning" element={<LearningPage />} />
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
              path="assistant"
              element={
                <WebChatRoute>
                  <AssistantPage />
                </WebChatRoute>
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
              <Route path="announcements" element={<AdminAnnouncementsPage />} />
              <Route path="sync" element={<AdminSyncPage />} />
              <Route path="health" element={<AdminSourceHealthPage />} />
              <Route path="webchat" element={<AdminWebChatPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
