import MailCheck from 'lucide-react/dist/esm/icons/mail-check'
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { RegistrationTurnstile } from '../components/RegistrationTurnstile'
import { getRegistrationCaptchaConfig } from '../lib/registrationCaptcha'
import { demoAuthEnabled, supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const captchaConfig = getRegistrationCaptchaConfig()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (captchaConfig.configurationError) {
      setError(captchaConfig.configurationError)
      return
    }
    if (captchaConfig.enabled && !captchaToken) {
      setError('请先完成找回密码安全验证。')
      return
    }
    if (!supabase && !demoAuthEnabled) {
      setError('系统尚未配置 Supabase，密码重置暂不可用。')
      return
    }
    setSubmitting(true)
    if (supabase) {
      const redirectTo = new URL(
        `${import.meta.env.BASE_URL}reset-password`,
        window.location.origin,
      ).toString()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
        ...(captchaConfig.enabled ? { captchaToken } : {}),
      })
      if (resetError) {
        setSubmitting(false)
        setError(resetError.message)
        if (captchaConfig.enabled) {
          setCaptchaToken('')
          setCaptchaResetKey((current) => current + 1)
        }
        return
      }
    }
    setSubmitting(false)
    setMessage('如果该邮箱已注册，重置邮件将很快送达。')
  }

  return (
    <main id="main-content" className="simple-auth-page" tabIndex={-1}>
      <form className="auth-form standalone-form" onSubmit={handleSubmit}>
        <div>
          <h1>找回密码</h1>
          <p>输入注册邮箱接收密码重置链接。</p>
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
        {captchaConfig.enabled && captchaConfig.siteKey ? (
          <RegistrationTurnstile
            siteKey={captchaConfig.siteKey}
            resetKey={captchaResetKey}
            onTokenChange={setCaptchaToken}
            ariaLabel="找回密码安全验证"
          />
        ) : null}
        {captchaConfig.configurationError ? (
          <p className="form-error" role="alert">
            {captchaConfig.configurationError}
          </p>
        ) : null}
        {message ? (
          <p className="form-success" role="status">
            {message}
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
          disabled={
            submitting ||
            Boolean(captchaConfig.configurationError) ||
            (captchaConfig.enabled && !captchaToken)
          }
        >
          <MailCheck size={17} aria-hidden="true" />
          {submitting ? '发送中' : '发送重置邮件'}
        </button>
        <p className="centered-link">
          <Link to="/login">返回登录</Link>
        </p>
      </form>
    </main>
  )
}
