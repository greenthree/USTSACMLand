import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import type { FormEvent } from 'react'
import { RegistrationTurnstile } from '../../components/RegistrationTurnstile'
import type { getRegistrationCaptchaConfig } from '../../lib/registrationCaptcha'

interface AccountPasswordSectionProps {
  currentPassword: string
  onCurrentPasswordChange: (value: string) => void
  newPassword: string
  onNewPasswordChange: (value: string) => void
  confirmedPassword: string
  onConfirmedPasswordChange: (value: string) => void
  changingPassword: boolean
  passwordNotice: string
  passwordNoticeKind: 'success' | 'error'
  captchaConfig: ReturnType<typeof getRegistrationCaptchaConfig>
  passwordCaptchaResetKey: number
  onPasswordCaptchaTokenChange: (token: string) => void
  passwordCaptchaToken: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function AccountPasswordSection({
  currentPassword,
  onCurrentPasswordChange,
  newPassword,
  onNewPasswordChange,
  confirmedPassword,
  onConfirmedPasswordChange,
  changingPassword,
  passwordNotice,
  passwordNoticeKind,
  captchaConfig,
  passwordCaptchaResetKey,
  onPasswordCaptchaTokenChange,
  passwordCaptchaToken,
  onSubmit,
}: AccountPasswordSectionProps) {
  return (
    <form className="account-form account-security-form" onSubmit={onSubmit}>
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
              onChange={(event) => onCurrentPasswordChange(event.target.value)}
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
              onChange={(event) => onNewPasswordChange(event.target.value)}
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
              onChange={(event) => onConfirmedPasswordChange(event.target.value)}
            />
          </label>
        </div>
        {captchaConfig.enabled && captchaConfig.siteKey ? (
          <RegistrationTurnstile
            siteKey={captchaConfig.siteKey}
            resetKey={passwordCaptchaResetKey}
            onTokenChange={onPasswordCaptchaTokenChange}
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
