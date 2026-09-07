import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import { type FormEvent, useState } from 'react'
import { useAuth } from '../../auth/authContextValue'
import { RegistrationTurnstile } from '../../components/RegistrationTurnstile'
import { clearAccountDraft } from '../../lib/accountDraft'
import type { getRegistrationCaptchaConfig } from '../../lib/registrationCaptcha'

interface AccountDeletionSectionProps {
  isAdmin: boolean
  userId?: string
  captchaConfig: ReturnType<typeof getRegistrationCaptchaConfig>
}

export function AccountDeletionSection({
  isAdmin,
  userId,
  captchaConfig,
}: AccountDeletionSectionProps) {
  const { user, deleteAccount } = useAuth()
  const [showDeletionConfirmation, setShowDeletionConfirmation] = useState(false)
  const [deletionPassword, setDeletionPassword] = useState('')
  const [deletionConfirmed, setDeletionConfirmed] = useState(false)
  const [deletionNotice, setDeletionNotice] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deletionCaptchaToken, setDeletionCaptchaToken] = useState('')
  const [deletionCaptchaResetKey, setDeletionCaptchaResetKey] = useState(0)

  function handleCancel() {
    setShowDeletionConfirmation(false)
    setDeletionPassword('')
    setDeletionConfirmed(false)
    setDeletionNotice('')
    setDeletionCaptchaToken('')
    setDeletionCaptchaResetKey((current) => current + 1)
  }

  async function handleAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      user?.role !== 'member' ||
      !deletionConfirmed ||
      !deletionPassword ||
      (captchaConfig.enabled && !deletionCaptchaToken)
    ) {
      return
    }

    setDeletingAccount(true)
    setDeletionNotice('')
    try {
      if (captchaConfig.enabled) {
        await deleteAccount(deletionPassword, deletionCaptchaToken)
      } else {
        await deleteAccount(deletionPassword)
      }
      if (userId) clearAccountDraft(userId)
    } catch (error) {
      setDeletionPassword('')
      setDeletionNotice(error instanceof Error ? error.message : '账号注销失败，请稍后重试。')
      setDeletingAccount(false)
    } finally {
      setDeletionCaptchaToken('')
      setDeletionCaptchaResetKey((current) => current + 1)
    }
  }

  return (
    <form className="account-form account-danger-form" onSubmit={handleAccountDeletion}>
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
                onChange={(event) => setDeletionPassword(event.target.value)}
              />
            </label>
            <label className="account-deletion-checkbox">
              <input
                type="checkbox"
                required
                checked={deletionConfirmed}
                onChange={(event) => setDeletionConfirmed(event.target.checked)}
              />
              <span>我确认永久删除账号及全部训练数据，此操作无法撤销。</span>
            </label>
            {captchaConfig.enabled && captchaConfig.siteKey ? (
              <RegistrationTurnstile
                siteKey={captchaConfig.siteKey}
                resetKey={deletionCaptchaResetKey}
                onTokenChange={setDeletionCaptchaToken}
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
                onClick={handleCancel}
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
              onClick={() => setShowDeletionConfirmation(true)}
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
