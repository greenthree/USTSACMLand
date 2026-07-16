import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { completePasswordRecovery, isPasswordRecovery, status } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmedPassword, setConfirmedPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmedPassword) {
      setError('两次输入的新密码不一致。')
      return
    }

    setSubmitting(true)
    try {
      await completePasswordRecovery(newPassword)
      setNewPassword('')
      setConfirmedPassword('')
      navigate('/login?reset=success', { replace: true })
    } catch (recoveryError) {
      setSubmitting(false)
      setNewPassword('')
      setConfirmedPassword('')
      setError(
        recoveryError instanceof Error ? recoveryError.message : '密码重置失败，请重新申请。',
      )
    }
  }

  const recoveryReady = status !== 'loading' && isPasswordRecovery

  return (
    <main id="main-content" className="simple-auth-page" tabIndex={-1}>
      <form className="auth-form standalone-form" onSubmit={handleSubmit}>
        <div>
          <h1>设置新密码</h1>
          <p>
            {status === 'loading'
              ? '正在验证密码重置链接。'
              : recoveryReady
                ? '验证已通过，请设置新的登录密码。'
                : '密码重置链接无效或已过期，请重新申请。'}
          </p>
        </div>

        {recoveryReady ? (
          <>
            <label>
              <span id="recovery-new-password-label">新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                aria-labelledby="recovery-new-password-label"
                aria-describedby="recovery-new-password-help"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <small id="recovery-new-password-help">至少 8 位，不要与其他网站共用。</small>
            </label>
            <label>
              <span>确认新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmedPassword}
                onChange={(event) => setConfirmedPassword(event.target.value)}
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="primary-button full-button" type="submit" disabled={submitting}>
              <KeyRound size={17} aria-hidden="true" />
              {submitting ? '重置中' : '重置密码'}
            </button>
          </>
        ) : (
          <p className="centered-link">
            <Link to="/forgot-password">重新发送重置邮件</Link>
          </p>
        )}
      </form>
    </main>
  )
}
