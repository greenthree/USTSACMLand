import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import ShieldOff from 'lucide-react/dist/esm/icons/shield-off'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import { useCallback, useEffect, useState } from 'react'
import { ConfirmModal } from '../ConfirmModal'
import { formatDateTime } from '../../lib/format'
import {
  fetchAdminAuthCaptchaConfig,
  updateAdminAuthCaptchaConfig,
  type AdminAuthCaptchaConfig,
} from '../../lib/adminAuthCaptcha'
import { supabase } from '../../lib/supabase'

export function AdminAuthCaptchaPanel() {
  const demo = !supabase
  const [config, setConfig] = useState<AdminAuthCaptchaConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [reason, setReason] = useState('')
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      setConfig(await fetchAdminAuthCaptchaConfig())
    } catch (error) {
      setConfig(null)
      setNotice(error instanceof Error ? error.message : 'Auth CAPTCHA 配置读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function update() {
    if (!config || pendingEnabled === null) return
    setSaving(true)
    setNotice('')
    try {
      setConfig(
        await updateAdminAuthCaptchaConfig({
          enabled: pendingEnabled,
          expectedVersion: config.version,
          reason: reason.trim(),
        }),
      )
      setReason('')
      setPendingEnabled(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Auth CAPTCHA 配置更新失败。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-section auth-captcha-panel" aria-labelledby="auth-captcha-title">
      <div className="section-title-row">
        <div>
          <h2 id="auth-captcha-title">登录安全验证</h2>
          <p>通过 Cloudflare Turnstile 保护注册、登录、找回密码和敏感账号操作。</p>
        </div>
        <span className="demo-indicator">{demo ? '演示配置' : '生产配置'}</span>
      </div>

      {notice ? (
        <p className="form-error admin-notice" role="alert">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="admin-notice" role="status">
          正在读取 Auth CAPTCHA 配置…
        </p>
      ) : config ? (
        <>
          <div
            className="admin-metric-strip auth-captcha-status-strip"
            aria-label="Auth CAPTCHA 状态"
          >
            <div>
              {config.enabled ? (
                <ShieldCheck size={19} aria-hidden="true" />
              ) : (
                <ShieldOff size={19} aria-hidden="true" />
              )}
              <span>当前状态</span>
              <strong>{config.enabled ? '已启用' : '已关闭'}</strong>
            </div>
            <div>
              <RefreshCw size={19} aria-hidden="true" />
              <span>配置版本</span>
              <strong>v{config.version}</strong>
            </div>
            <div>
              <ShieldCheck size={19} aria-hidden="true" />
              <span>最近更新</span>
              <strong>{formatDateTime(config.updatedAt)}</strong>
            </div>
          </div>

          <div className="auth-captcha-controls">
            <label className="field-label" htmlFor="auth-captcha-reason">
              变更原因
              <input
                id="auth-captcha-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder="例如：临时恢复登录入口，验证完成后立即重新启用"
              />
            </label>
            <div className="auth-captcha-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={saving || reason.trim().length < 3}
                onClick={() => setPendingEnabled(!config.enabled)}
              >
                {config.enabled ? '申请关闭' : '申请启用'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => void load()}
                disabled={loading || saving}
              >
                <RefreshCw size={15} aria-hidden="true" /> 刷新状态
              </button>
            </div>
          </div>

          <p className="admin-security-note">
            开关会先更新 Supabase
            Auth，再写入审计配置；任一步失败均保持原状态。管理凭据不会返回浏览器。
          </p>

          <ConfirmModal
            open={pendingEnabled !== null}
            title={pendingEnabled ? '启用登录安全验证？' : '关闭登录安全验证？'}
            description={
              <p>
                {pendingEnabled
                  ? '启用后，注册、登录、找回密码和敏感账号操作需要新的 Turnstile token。'
                  : '关闭后，以上入口将不再要求 Cloudflare Turnstile。请确认这是短时、可审计的维护操作。'}
              </p>
            }
            confirmText={pendingEnabled ? '确认启用' : '确认关闭'}
            danger={!pendingEnabled}
            busy={saving}
            onConfirm={update}
            onCancel={() => setPendingEnabled(null)}
          />
        </>
      ) : null}
    </section>
  )
}
