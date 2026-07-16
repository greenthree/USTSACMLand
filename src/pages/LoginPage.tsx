import LogIn from 'lucide-react/dist/esm/icons/log-in'
import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { consumePasswordChangeNotice } from '../auth/passwordChangeNotice'
import { SiteLogo } from '../components/SiteLogo'
import { hasSupabaseConfig } from '../lib/supabase'

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { signIn, status, user, isDemo } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [passwordChangeNotice] = useState(consumePasswordChangeNotice)
  const passwordResetCompleted = searchParams.get('reset') === 'success'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(email, password)
      const requestedPath = searchParams.get('returnTo')
      const safePath = requestedPath?.startsWith('/') ? requestedPath : null
      navigate(
        safePath ?? (email.trim().toLowerCase().startsWith('admin@') ? '/admin' : '/account'),
      )
    } catch (signInError) {
      setSubmitting(false)
      setError(signInError instanceof Error ? signInError.message : '登录失败，请稍后重试。')
      return
    }
  }

  return (
    <main id="main-content" className="auth-page" tabIndex={-1}>
      <section className="auth-context">
        <div className="auth-context-inner">
          <SiteLogo className="auth-logo" />
          <h1>USTS ACM Land</h1>
          <p>苏州科技大学 ACM 集训队</p>
          <dl>
            <div>
              <dt>6</dt>
              <dd>数据平台</dd>
            </div>
            <div>
              <dt>8</dt>
              <dd>核心指标</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="auth-form-section">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div>
            <h2>登录</h2>
            <p>
              {hasSupabaseConfig
                ? '使用注册邮箱进入系统。'
                : isDemo
                  ? '当前为本地演示模式，admin@ 开头的邮箱进入后台。'
                  : '系统尚未配置 Supabase，登录暂不可用。'}
            </p>
          </div>
          <label>
            <span>邮箱</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {passwordResetCompleted ? (
            <p className="form-success" role="status">
              密码已重置，请使用新密码登录。
            </p>
          ) : null}
          {passwordChangeNotice === 'success' ? (
            <p className="form-success" role="status">
              密码已更新，所有设备均已退出，请使用新密码登录。
            </p>
          ) : null}
          {passwordChangeNotice === 'revocation-warning' ? (
            <p className="form-error" role="alert">
              密码已更新，本设备已退出，但无法确认其他设备会话均已撤销。请使用新密码重新登录并检查账号安全。
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="primary-button full-button"
            type="submit"
            disabled={submitting || status === 'unavailable' || Boolean(user)}
          >
            <LogIn size={17} aria-hidden="true" />
            {user ? '已登录' : submitting ? '登录中' : '登录'}
          </button>
          <div className="auth-links">
            <Link to="/forgot-password">忘记密码</Link>
            <Link to="/register">创建账号</Link>
            <Link to="/privacy">隐私说明</Link>
          </div>
        </form>
      </section>
    </main>
  )
}
