import Power from 'lucide-react/dist/esm/icons/power'
import PowerOff from 'lucide-react/dist/esm/icons/power-off'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import X from 'lucide-react/dist/esm/icons/x'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import {
  fetchAdminReferralProgramConfig,
  updateAdminReferralProgramConfig,
  type AdminReferralProgramConfig,
} from '../../lib/adminReferralProgram'
import { formatDateTime } from '../../lib/format'
import { LoadingState } from '../LoadingState'

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function AdminReferralProgramPanel() {
  const [config, setConfig] = useState<AdminReferralProgramConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [notice, setNotice] = useState('')
  const [targetEnabled, setTargetEnabled] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const { closeDialog, dialogRef, handleDialogKeyDown, rememberDialogTrigger } = useDialogFocus()

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setConfig(await fetchAdminReferralProgramConfig())
    } catch (error) {
      setLoadError(message(error, '推荐计划配置读取失败。'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  function openConfirmation(requestedEnabled: boolean, trigger: HTMLButtonElement) {
    rememberDialogTrigger(trigger)
    setTargetEnabled(requestedEnabled)
    setReason('')
    setConfirmed(false)
    setDialogError('')
    setNotice('')
  }

  function closeConfirmation() {
    closeDialog(() => {
      setTargetEnabled(null)
      setReason('')
      setConfirmed(false)
      setDialogError('')
    })
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedReason = reason.trim().replace(/\s+/g, ' ')
    if (
      !config ||
      targetEnabled === null ||
      !confirmed ||
      normalizedReason.length < 3 ||
      normalizedReason.length > 500
    ) {
      return
    }

    const requestedEnabled = targetEnabled
    setSaving(true)
    setDialogError('')
    setNotice('')

    try {
      const updated = await updateAdminReferralProgramConfig(
        requestedEnabled,
        config.version,
        normalizedReason,
      )
      setConfig(updated)

      if (updated.enabled !== requestedEnabled) {
        setConfirmed(false)
        setDialogError(
          `服务端返回的状态与本次目标不一致，已加载版本 ${updated.version}，请重新核对并确认。`,
        )
        return
      }

      closeConfirmation()
      setNotice(`推荐计划已${requestedEnabled ? '全线开启' : '全线关闭'}。`)
    } catch (updateError) {
      const updateMessage = message(updateError, '推荐计划配置更新失败。')
      try {
        const latest = await fetchAdminReferralProgramConfig()
        setConfig(latest)

        if (
          latest.enabled === requestedEnabled &&
          latest.version === config.version + 1 &&
          latest.reason === normalizedReason
        ) {
          closeConfirmation()
          setNotice(
            `推荐计划已${requestedEnabled ? '全线开启' : '全线关闭'}，并已通过服务端状态复核。`,
          )
        } else {
          setConfirmed(false)
          setDialogError(
            `${updateMessage} 已重新加载最新配置（版本 ${latest.version}），请重新核对并勾选确认。`,
          )
        }
      } catch (reloadError) {
        setConfirmed(false)
        setDialogError(
          `${updateMessage} 状态复核也未完成：${message(reloadError, '配置读取失败。')}`,
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const normalizedReasonLength = reason.trim().replace(/\s+/g, ' ').length
  const canSubmit =
    !saving && confirmed && normalizedReasonLength >= 3 && normalizedReasonLength <= 500

  return (
    <section
      className="admin-section referral-program-panel"
      aria-labelledby="referral-program-title"
      aria-busy={loading || saving}
    >
      <header className="referral-program-heading">
        <div>
          <h2 id="referral-program-title">推荐计划</h2>
          <p>统一控制邀请码展示、校验、新绑定与新奖励，已有数据和额度不会被撤回。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={loading || saving}
          onClick={() => void loadConfig()}
        >
          <RefreshCw className={loading ? 'is-spinning' : undefined} size={15} aria-hidden="true" />
          刷新状态
        </button>
      </header>

      {notice ? (
        <p className="form-success referral-program-notice" role="status">
          {notice}
        </p>
      ) : null}

      {loadError ? (
        <div className="form-error referral-program-error" role="alert">
          <span>{loadError}</span>
          <button className="secondary-button" type="button" onClick={() => void loadConfig()}>
            重新读取
          </button>
        </div>
      ) : null}

      {loading && !config ? <LoadingState label="正在读取推荐计划状态" /> : null}

      {config ? (
        <div className="referral-program-status">
          <div
            className={`referral-program-state referral-program-state--${config.enabled ? 'enabled' : 'paused'}`}
          >
            <span className="referral-program-state-label">
              {config.enabled ? '全线开启' : '全线关闭'}
            </span>
            <strong>{config.enabled ? '推荐计划正在运行' : '推荐计划已暂停'}</strong>
            <p>
              {config.enabled
                ? '成员可展示并分享邀请码，新注册可建立绑定并发放奖励。'
                : '新用户仍可正常注册；邀请码、历史绑定与已发奖励均会保留。'}
            </p>
          </div>

          <dl className="referral-program-meta">
            <div>
              <dt>配置版本</dt>
              <dd>v{config.version}</dd>
            </div>
            <div>
              <dt>最后修改</dt>
              <dd>{formatDateTime(config.updatedAt)}</dd>
            </div>
            <div>
              <dt>修改人</dt>
              <dd>{config.updatedByLabel}</dd>
            </div>
            <div className="referral-program-meta-reason">
              <dt>变更原因</dt>
              <dd>{config.reason ?? '尚无变更说明'}</dd>
            </div>
          </dl>

          <button
            className={config.enabled ? 'secondary-button' : 'primary-button'}
            type="button"
            disabled={loading || saving}
            onClick={(event) => openConfirmation(!config.enabled, event.currentTarget)}
          >
            {config.enabled ? (
              <PowerOff size={16} aria-hidden="true" />
            ) : (
              <Power size={16} aria-hidden="true" />
            )}
            {config.enabled ? '关闭推荐计划' : '开启推荐计划'}
          </button>
        </div>
      ) : null}

      {config && targetEnabled !== null ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog referral-program-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="referral-program-dialog-title"
            aria-describedby="referral-program-dialog-description"
            ref={dialogRef}
            onKeyDown={(event) => handleDialogKeyDown(event, closeConfirmation, saving)}
          >
            <form onSubmit={(event) => void submitUpdate(event)}>
              <div className="admin-dialog-header">
                <h2 id="referral-program-dialog-title">
                  确认{targetEnabled ? '开启' : '关闭'}推荐计划
                </h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭推荐计划确认对话框"
                  disabled={saving}
                  onClick={closeConfirmation}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>

              <p id="referral-program-dialog-description">
                {targetEnabled
                  ? '开启后成员可继续使用原邀请码，新注册可建立绑定并发放奖励；关闭期间的注册不会追补奖励。'
                  : '关闭后邀请码展示、公开校验、新绑定与新奖励会立即停止；已有邀请码、绑定和奖励保持不变。'}
              </p>

              {dialogError ? (
                <p className="form-error referral-program-dialog-error" role="alert">
                  {dialogError}
                </p>
              ) : null}

              <label className="admin-dialog-field">
                <span id="referral-program-reason-label">变更原因</span>
                <textarea
                  autoFocus
                  aria-labelledby="referral-program-reason-label"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="说明本次全局开关的原因"
                />
                <small>{normalizedReasonLength} / 500</small>
              </label>

              <label className="referral-program-confirmation">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={saving}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  <strong>我已核对全站影响</strong>
                  <small>本次操作会记录管理员、前后状态、版本与变更原因。</small>
                </span>
              </label>

              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={closeConfirmation}
                >
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={!canSubmit}>
                  {saving ? '正在提交' : `确认${targetEnabled ? '开启' : '关闭'}`}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}
