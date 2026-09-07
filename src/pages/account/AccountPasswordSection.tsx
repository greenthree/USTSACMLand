import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import { type FormEvent, useState } from 'react'
import { useAuth } from '../../auth/authContextValue'
import { RegistrationTurnstile } from '../../components/RegistrationTurnstile'
import type { getRegistrationCaptchaConfig } from '../../lib/registrationCaptcha'

interface AccountPasswordSectionProps {
  captchaConfig: ReturnType<typeof getRegistrationCaptchaConfig>
}

export function AccountPasswordSection({ captchaConfig }: AccountPasswordSectionProps) {
  const { changePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmedPassword, setConfirmedPassword] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [passwordNoticeKind, setPasswordNoticeKind] = useState<'success' | 'error'>('success')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordCaptchaToken, setPasswordCaptchaToken] = useState('')
  const [passwordCaptchaResetKey, setPasswordCaptchaResetKey] = useState(0)

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordNotice('')

    const resetPasswordCaptcha = () => {
      setPasswordCaptchaToken('')
      setPasswordCaptchaResetKey((current) => current + 1)
    }

    if (newPassword.length < 8) {
      setPasswordNoticeKind('error')
      setPasswordNotice('新密码至少需要 8 位。')
      resetPasswordCaptcha()
      return
    }
    if (newPassword !== confirmedPassword) {
      setPasswordNoticeKind('error')
      setPasswordNotice('两次输入的新密码不一致。')
      resetPasswordCaptcha()
      return
    }
    if (newPassword === currentPassword) {
      setPasswordNoticeKind('error')
      setPasswordNotice('新密码不能与当前密码相同。')
      resetPasswordCaptcha()
      return
    }
    if (captchaConfig.configurationError) {
      setPasswordNoticeKind('error')
      setPasswordNotice(captchaConfig.configurationError)
      resetPasswordCaptcha()
      return
    }
    if (captchaConfig.enabled && !passwordCaptchaToken) {
      setPasswordNoticeKind('error')
      setPasswordNotice('请先完成修改密码安全验证。')
      resetPasswordCaptcha()
      return
    }

    setChangingPassword(true)
    try {
      if (captchaConfig.enabled) {
        await changePassword(currentPassword, newPassword, passwordCaptchaToken)
      } else {
        await changePassword(currentPassword, newPassword)
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmedPassword('')
      setPasswordNoticeKind('success')
      setPasswordNotice('密码已更新。')
    } catch (error) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmedPassword('')
      setPasswordNoticeKind('error')
      setPasswordNotice(error instanceof Error ? error.message : '密码更新失败，请稍后重试。')
    } finally {
      resetPasswordCaptcha()
      setChangingPassword(false)
    }
  }

  return (
    <form className="account-form account-security-form" onSubmit={handlePasswordChange}>
      <fieldset className="form-section" disabled={changingPassword}>
        <div className="section-title-row">
          <div>
            <h2>账号安全</h2>
            <p>修改密码前需要验证当前密码。</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>当前密码</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            <span id="account-new-password-label">新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-labelledby="account-new-password-label"
              aria-describedby="account-new-password-help"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <small id="account-new-password-help">至少 8 位，不要与其他网站共用。</small>
          </label>
          <label className="span-two">
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
        </div>
        {captchaConfig.enabled && captchaConfig.siteKey ? (
          <RegistrationTurnstile
            siteKey={captchaConfig.siteKey}
            resetKey={passwordCaptchaResetKey}
            onTokenChange={setPasswordCaptchaToken}
            ariaLabel="修改密码安全验证"
          />
        ) : null}
        {captchaConfig.configurationError ? (
          <p className="form-error" role="alert">
            {captchaConfig.configurationError}
          </p>
        ) : null}
        {passwordNotice ? (
          <p
            className={`form-${passwordNoticeKind} account-password-notice`}
            role={passwordNoticeKind === 'error' ? 'alert' : 'status'}
          >
            {passwordNotice}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={
              changingPassword ||
              Boolean(captchaConfig.configurationError) ||
              (captchaConfig.enabled && !passwordCaptchaToken)
            }
          >
            <KeyRound size={17} aria-hidden="true" />
            {changingPassword ? '更新中' : '修改密码'}
          </button>
        </div>
      </fieldset>
    </form>
  )
}
