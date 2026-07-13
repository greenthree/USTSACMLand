import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { demoAuthEnabled, supabase } from '../lib/supabase'

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!supabase) {
      if (demoAuthEnabled) {
        setMessage('演示模式已记录注册流程，连接 Supabase 后将发送验证邮件。')
      } else {
        setError('系统尚未配置 Supabase，注册暂不可用。')
      }
      return
    }

    const { error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) {
      setError(signUpError.message)
      return
    }
    setMessage('验证邮件已发送，请完成邮箱验证后登录。')
  }

  return (
    <div className="auth-page">
      <section className="auth-context">
        <div className="auth-context-inner">
          <span className="auth-monogram">UA</span>
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
            <p>完成邮箱验证后填写成员资料和竞赛账号。</p>
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
          <button className="primary-button full-button" type="submit">
            <UserPlus size={17} aria-hidden="true" />
            注册
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
