import { createContext, useContext } from 'react'
import type { ReviewStatus } from '../types/domain'

export type AppRole = 'member' | 'admin'
export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unavailable'

export interface AuthUser {
  id: string
  email: string
  role: AppRole
  reviewStatus: ReviewStatus
}

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  isDemo: boolean
  isPasswordRecovery: boolean
  signUp: (
    fullName: string,
    email: string,
    password: string,
    referralCode?: string,
  ) => Promise<boolean>
  signIn: (email: string, password: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  completePasswordRecovery: (newPassword: string) => Promise<void>
  deleteAccount: (currentPassword: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
