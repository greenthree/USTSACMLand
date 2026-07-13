import MailCheck from 'lucide-react/dist/esm/icons/mail-check'
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { demoAuthEnabled, supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!supabase && !demoAuthEnabled) {
      setError('系统尚未配置 Supabase，密码重置暂不可用。')
      return
    }
    if (supabase) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email)
      if (resetError) {
        setError(resetError.message)
        return
      }
    }
    setMessage('如果该邮箱已注册，重置邮件将很快送达。')
  }

  return (
    <div className="simple-auth-page">
      <form className="auth-form standalone-form" onSubmit={handleSubmit}>
        <div>
          <h1>找回密码</h1>
          <p>输入注册邮箱接收密码重置链接。</p>
        </div>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {message ? <p className="form-success">{message}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button full-button" type="submit">
          <MailCheck size={17} aria-hidden="true" />
          发送重置邮件
        </button>
        <p className="centered-link">
          <Link to="/login">返回登录</Link>
        </p>
      </form>
    </div>
  )
}
