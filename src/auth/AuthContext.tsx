import type { User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { demoAuthEnabled, supabase } from '../lib/supabase'
import type { ReviewStatus } from '../types/domain'
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type AuthUser,
} from './authContextValue'

const demoSessionKey = 'usts-acm-land-demo-session:v1'

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)

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
      if (active) void applySupabaseUser(data.session?.user ?? null)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void applySupabaseUser(session?.user ?? null)
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
      await applySupabaseUser(data.user)
    },
    [applySupabaseUser],
  )

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        if (!demoAuthEnabled) throw new Error('系统尚未配置 Supabase，注册暂不可用。')
        sessionStorage.setItem(demoSessionKey, email.trim())
        setUser(demoUser(email))
        setStatus('authenticated')
        return true
      }

      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      if (!data.session) return false

      await applySupabaseUser(data.user)
      return true
    },
    [applySupabaseUser],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!user?.email) throw new Error('当前账号没有可用邮箱。')
      if (newPassword.length < 8) throw new Error('新密码至少需要 8 位。')

      if (!supabase) {
        if (!demoAuthEnabled) throw new Error('系统尚未配置 Supabase，密码修改暂不可用。')
        return
      }

      const { error: reauthenticationError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (reauthenticationError) {
        throw new Error(`当前密码验证失败：${reauthenticationError.message}`)
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw new Error(`密码更新失败：${updateError.message}`)
    },
    [user?.email],
  )

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } else if (demoAuthEnabled) {
      sessionStorage.removeItem(demoSessionKey)
    }
    setUser(null)
    setStatus(supabase || demoAuthEnabled ? 'anonymous' : 'unavailable')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isDemo: demoAuthEnabled,
      signUp,
      signIn,
      changePassword,
      signOut,
    }),
    [changePassword, signIn, signOut, signUp, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
