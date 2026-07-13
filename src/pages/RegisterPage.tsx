import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { SiteLogo } from '../components/SiteLogo'

export function RegisterPage() {
  const navigate = useNavigate()
  const { signUp, status, user } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)

    try {
      const normalizedFullName = fullName.trim()
      if (!normalizedFullName) {
        setError('请输入姓名。')
        return
      }

      const signedIn = await signUp(normalizedFullName, email, password)
      if (signedIn) {
        navigate('/account', { replace: true })
        return
      }
      setMessage('账号已创建，但当前认证配置仍要求邮箱验证；验证后即可登录。')
    } catch (signUpError) {
      setError(signUpError instanceof Error ? signUpError.message : '注册失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-context">
        <div className="auth-context-inner">
          <SiteLogo className="auth-logo" />
          <h1>USTSACMLand</h1>
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
            <h2>创建账号</h2>
            <p>注册后直接填写竞赛账号和其他成员资料。</p>
          </div>
          <label>
            <span>姓名</span>
            <input
              type="text"
              autoComplete="name"
              maxLength={64}
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </label>
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
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small>至少 8 位，不要与其他网站共用。</small>
          </label>
          {message ? <p className="form-success">{message}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button full-button"
            type="submit"
            disabled={submitting || status === 'unavailable' || Boolean(user)}
          >
            <UserPlus size={17} aria-hidden="true" />
            {user ? '已登录' : submitting ? '注册中' : '注册'}
          </button>
          <p className="centered-link">
            已有账号？<Link to="/login">返回登录</Link>
          </p>
          <p className="auth-legal">
            注册前请阅读<Link to="/privacy">隐私说明</Link>
          </p>
        </form>
      </section>
    </div>
  )
}
