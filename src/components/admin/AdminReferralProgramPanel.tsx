import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchAdminReferralProgramConfig,
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
  const [loadError, setLoadError] = useState('')

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

  return (
    <section
      className="admin-section referral-program-panel"
      aria-labelledby="referral-program-title"
      aria-busy={loading}
    >
      <header className="referral-program-heading">
        <div>
          <h2 id="referral-program-title">推荐计划</h2>
          <p>推荐计划已退出产品范围，配置保持只读关闭状态；已有数据与历史记录继续保留。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={loading}
          onClick={() => void loadConfig()}
        >
          <RefreshCw className={loading ? 'is-spinning' : undefined} size={15} aria-hidden="true" />
          刷新状态
        </button>
      </header>

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
              {config.enabled ? '只读关闭（遗留值开启）' : '只读关闭'}
            </span>
            <strong>{config.enabled ? '推荐计划已废弃关闭' : '推荐计划已永久关闭'}</strong>
            <p>
              推荐计划已退出当前及未来产品范围，不开放邀请码发放、注册绑定或额度奖励；历史绑定与已发记录安全封存。
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
              <dd>{config.reason ?? '推荐计划已退出产品范围，配置保持只读关闭状态'}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  )
}
