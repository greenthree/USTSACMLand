import type { User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { demoAuthEnabled, supabase } from '../lib/supabase'
import { clearAccountDraft } from '../lib/accountDraft'
import {
  checkReferralCodeAvailability,
  normalizeReferralCode,
  referralCodeError,
} from '../lib/referrals'
import type { ReviewStatus } from '../types/domain'
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type AuthUser,
} from './authContextValue'
import { storePasswordChangeNotice } from './passwordChangeNotice'

const demoSessionKey = 'usts-acm-land-demo-session:v1'
const passwordRecoverySessionKey = 'usts-acm-land-password-recovery:v1'

function clearPasswordRecoverySession() {
  sessionStorage.removeItem(passwordRecoverySessionKey)
}

function markPasswordRecoverySession() {
  sessionStorage.setItem(passwordRecoverySessionKey, 'active')
}

function demoUser(email: string): AuthUser {
  const normalizedEmail = email.trim().toLocaleLowerCase('en-US')
  return {
    id: `demo:${normalizedEmail}`,
    email: normalizedEmail,
    role: normalizedEmail.startsWith('admin@') ? 'admin' : 'member',
    reviewStatus: 'approved',
  }
}

async function loadSupabaseUser(user: User): Promise<AuthUser> {
  const { data: profile, error } = await supabase!
    .from('profiles')
    .select('role, review_status')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw new Error(`无法读取账号权限：${error.message}`)

  return {
    id: user.id,
    email: user.email ?? '',
    role: profile?.role === 'admin' ? 'admin' : 'member',
    reviewStatus: (profile?.review_status as ReviewStatus | undefined) ?? 'pending',
  }
}

async function startRegistrationXcpcSync(memberId: string) {
  if (!supabase) return

  try {
    await supabase.functions.invoke('sync-member', {
      body: {
        memberId,
        platforms: ['xcpc_elo'],
        triggerType: 'registration',
      },
    })
  } catch {
    // The browser submits once; retryable platform failures are owned by sync_jobs.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () => sessionStorage.getItem(passwordRecoverySessionKey) === 'active',
  )

  const applySupabaseUser = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setUser(null)
      setStatus('anonymous')
      return
    }

    try {
      setUser(await loadSupabaseUser(nextUser))
      setStatus('authenticated')
    } catch {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      clearPasswordRecoverySession()
      setIsPasswordRecovery(false)
      if (!demoAuthEnabled) {
        setStatus('unavailable')
        return
      }

      const email = sessionStorage.getItem(demoSessionKey)
      if (email) {
        setUser(demoUser(email))
        setStatus('authenticated')
      } else {
        setStatus('anonymous')
      }
      return
    }

    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (!data.session) {
        clearPasswordRecoverySession()
        setIsPasswordRecovery(false)
      }
      void applySupabaseUser(data.session?.user ?? null)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' && session) {
        markPasswordRecoverySession()
        setIsPasswordRecovery(true)
      } else if (event === 'SIGNED_OUT') {
        clearPasswordRecoverySession()
        setIsPasswordRecovery(false)
      }
      void applySupabaseUser(session?.user ?? null)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [applySupabaseUser])

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        if (!demoAuthEnabled) throw new Error('系统尚未配置 Supabase，登录暂不可用。')
        sessionStorage.setItem(demoSessionKey, email.trim())
        setUser(demoUser(email))
        setStatus('authenticated')
        return
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      clearPasswordRecoverySession()
      setIsPasswordRecovery(false)
      await applySupabaseUser(data.user)
    },
    [applySupabaseUser],
  )

  const signUp = useCallback(
    async (fullName: string, email: string, password: string, referralCode = '') => {
      const normalizedFullName = fullName.trim()
      const normalizedReferralCode = normalizeReferralCode(referralCode)
      if (!normalizedFullName) throw new Error('请输入姓名。')
      if (normalizedFullName.length > 64) throw new Error('姓名不能超过 64 个字符。')

      if (!supabase) {
        const referralError = referralCodeError(normalizedReferralCode)
        if (referralError) throw new Error(referralError)
        if (!demoAuthEnabled) throw new Error('系统尚未配置 Supabase，注册暂不可用。')
        sessionStorage.setItem(demoSessionKey, email.trim())
        setUser(demoUser(email))
        setStatus('authenticated')
        return true
      }

      let acceptedReferralCode = ''
      if (normalizedReferralCode) {
        const referralStatus = await checkReferralCodeAvailability(normalizedReferralCode)
        if (referralStatus.programEnabled) {
          const referralError = referralCodeError(normalizedReferralCode)
          if (referralError) throw new Error(referralError)
          if (!referralStatus.available) {
            throw new Error('邀请码不存在、已停用或已达到邀请上限。')
          }
          acceptedReferralCode = normalizedReferralCode
        }
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: normalizedFullName,
            ...(acceptedReferralCode ? { referral_code: acceptedReferralCode } : {}),
          },
        },
      })
      if (error) throw error
      if (!data.session || !data.user) return false

      clearPasswordRecoverySession()
      setIsPasswordRecovery(false)
      await applySupabaseUser(data.user)
      void startRegistrationXcpcSync(data.user.id)
      return true
    },
    [applySupabaseUser],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!user) throw new Error('请先登录后再修改密码。')
      if (newPassword.length < 8) throw new Error('新密码至少需要 8 位。')

      if (!supabase) {
        if (!demoAuthEnabled) throw new Error('系统尚未配置 Supabase，密码修改暂不可用。')
        return
      }

      const { data, error } = await supabase.functions.invoke('change-password', {
        body: { currentPassword, newPassword },
      })
      currentPassword = ''
      newPassword = ''
      if (error) throw new Error(`密码更新失败：${error.message}`)
      const result = data as { updated?: unknown; sessionsRevoked?: unknown } | null
      if (result?.updated !== true) throw new Error('密码更新失败：服务端未确认修改结果')

      storePasswordChangeNotice(result.sessionsRevoked === true ? 'success' : 'revocation-warning')
      clearAccountDraft(user.id)
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      setUser(null)
      setStatus('anonymous')
    },
    [user],
  )

  const deleteAccount = useCallback(
    async (currentPassword: string) => {
      if (!user) throw new Error('请先登录后再注销账号。')
      if (!currentPassword) throw new Error('请输入当前密码。')

      if (!supabase) {
        if (!demoAuthEnabled) throw new Error('系统尚未配置 Supabase，账号注销暂不可用。')
        clearAccountDraft(user.id)
        sessionStorage.removeItem(demoSessionKey)
        setUser(null)
        setStatus('anonymous')
        return
      }

      const { error } = await supabase.functions.invoke('delete-account', {
        body: { currentPassword },
      })
      currentPassword = ''
      if (error) throw new Error(`账号注销失败：${error.message}`)

      clearAccountDraft(user.id)
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      setUser(null)
      setStatus('anonymous')
    },
    [user],
  )

  const completePasswordRecovery = useCallback(
    async (newPassword: string) => {
      if (!supabase) {
        throw new Error('系统尚未配置 Supabase，密码重置暂不可用。')
      }
      if (!isPasswordRecovery) throw new Error('密码重置链接无效或已过期。')
      if (newPassword.length < 8) throw new Error('新密码至少需要 8 位。')

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      newPassword = ''
      if (updateError) throw new Error(`密码重置失败：${updateError.message}`)

      clearPasswordRecoverySession()
      setIsPasswordRecovery(false)
      const { error: globalSignOutError } = await supabase.auth.signOut({ scope: 'global' })
      if (globalSignOutError) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      }
      setUser(null)
      setStatus('anonymous')
    },
    [isPasswordRecovery],
  )

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } else if (demoAuthEnabled) {
      sessionStorage.removeItem(demoSessionKey)
    }
    if (user?.id) clearAccountDraft(user.id)
    clearPasswordRecoverySession()
    setIsPasswordRecovery(false)
    setUser(null)
    setStatus(supabase || demoAuthEnabled ? 'anonymous' : 'unavailable')
  }, [user?.id])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isDemo: demoAuthEnabled,
      isPasswordRecovery,
      signUp,
      signIn,
      changePassword,
      completePasswordRecovery,
      deleteAccount,
      signOut,
    }),
    [
      changePassword,
      completePasswordRecovery,
      deleteAccount,
      isPasswordRecovery,
      signIn,
      signOut,
      signUp,
      status,
      user,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
