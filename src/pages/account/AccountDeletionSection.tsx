import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import type { FormEvent } from 'react'
import { RegistrationTurnstile } from '../../components/RegistrationTurnstile'
import type { getRegistrationCaptchaConfig } from '../../lib/registrationCaptcha'

interface AccountDeletionSectionProps {
  isAdmin: boolean
  showDeletionConfirmation: boolean
  onShowConfirmation: (show: boolean) => void
  deletionPassword: string
  onDeletionPasswordChange: (value: string) => void
  deletionConfirmed: boolean
  onDeletionConfirmedChange: (checked: boolean) => void
  deletingAccount: boolean
  deletionNotice: string
  captchaConfig: ReturnType<typeof getRegistrationCaptchaConfig>
  deletionCaptchaResetKey: number
  onDeletionCaptchaTokenChange: (token: string) => void
  deletionCaptchaToken: string
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function AccountDeletionSection({
  isAdmin,
  showDeletionConfirmation,
  onShowConfirmation,
  deletionPassword,
  onDeletionPasswordChange,
  deletionConfirmed,
  onDeletionConfirmedChange,
  deletingAccount,
  deletionNotice,
  captchaConfig,
  deletionCaptchaResetKey,
  onDeletionCaptchaTokenChange,
  deletionCaptchaToken,
  onCancel,
  onSubmit,
}: AccountDeletionSectionProps) {
  return (
    <form className="account-form account-danger-form" onSubmit={onSubmit}>
      <fieldset className="form-section danger-zone" disabled={deletingAccount}>
        <div className="section-title-row">
          <div>
            <h2>注销账号</h2>
            <p>注销后，账号、个人资料、平台绑定和全部统计记录将永久删除。</p>
          </div>
        </div>

        {isAdmin ? (
          <p className="danger-zone-note">
            管理员账号不能自助注销；请先完成管理员交接并移除管理员身份。
          </p>
        ) : showDeletionConfirmation ? (
          <div className="account-deletion-confirmation">
            <label>
              <span>账号密码</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                value={deletionPassword}
                onChange={(event) => onDeletionPasswordChange(event.target.value)}
              />
            </label>
            <label className="account-deletion-checkbox">
              <input
                type="checkbox"
                required
                checked={deletionConfirmed}
                onChange={(event) => onDeletionConfirmedChange(event.target.checked)}
              />
              <span>我确认永久删除账号及全部训练数据，此操作无法撤销。</span>
            </label>
            {captchaConfig.enabled && captchaConfig.siteKey ? (
              <RegistrationTurnstile
                siteKey={captchaConfig.siteKey}
                resetKey={deletionCaptchaResetKey}
                onTokenChange={onDeletionCaptchaTokenChange}
                ariaLabel="注销账号安全验证"
              />
            ) : null}
            {captchaConfig.configurationError ? (
              <p className="form-error" role="alert">
                {captchaConfig.configurationError}
              </p>
            ) : null}
            {deletionNotice ? (
              <p className="form-error account-deletion-notice" role="alert">
                {deletionNotice}
              </p>
            ) : null}
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={deletingAccount}
                onClick={onCancel}
              >
                取消
              </button>
              <button
                className="danger-button"
                type="submit"
                disabled={
                  deletingAccount ||
                  !deletionPassword ||
                  !deletionConfirmed ||
                  Boolean(captchaConfig.configurationError) ||
                  (captchaConfig.enabled && !deletionCaptchaToken)
                }
              >
                <Trash2 size={17} aria-hidden="true" />
                {deletingAccount ? '正在注销' : '永久注销账号'}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            <button
              className="danger-button"
              type="button"
              onClick={() => onShowConfirmation(true)}
            >
              <Trash2 size={17} aria-hidden="true" />
              注销账号
            </button>
          </div>
        )}
      </fieldset>
    </form>
  )
}
