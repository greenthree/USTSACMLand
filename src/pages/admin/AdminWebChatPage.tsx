import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import Gauge from 'lucide-react/dist/esm/icons/gauge'
import Power from 'lucide-react/dist/esm/icons/power'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { AdminWebChatPilotPanel } from '../../components/admin/AdminWebChatPilotPanel'
import { fetchAdminWebChatConfig, type AdminWebChatConfig } from '../../lib/adminWebChatConfig'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'

const usageNumberFormatter = new Intl.NumberFormat('zh-CN')
const beijingResetFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

interface DailyUsageView {
  usageDate: string
  requestCount: number
  requestLimit: number
  requestRemaining: number
  requestProgress: number
  settledTokens: number
  reservedTokens: number
  occupiedTokens: number
  tokenLimit: number
  tokenRemaining: number
  tokenProgress: number
  resetAt: string
}

function dailyUsageView(config: AdminWebChatConfig): DailyUsageView {
  const usage = config.dailyUsage
  const requestCount = Math.max(0, usage.requestCount)
  const settledTokens = Math.max(0, usage.settledTokens)
  const reservedTokens = Math.max(0, usage.reservedTokens)
  const occupiedTokens = settledTokens + reservedTokens

  return {
    usageDate: usage.usageDate,
    requestCount,
    requestLimit: config.globalDailyRequestLimit,
    requestRemaining: Math.max(0, config.globalDailyRequestLimit - requestCount),
    requestProgress: Math.min(requestCount, config.globalDailyRequestLimit),
    settledTokens,
    reservedTokens,
    occupiedTokens,
    tokenLimit: config.globalDailyTokenLimit,
    tokenRemaining: Math.max(0, config.globalDailyTokenLimit - occupiedTokens),
    tokenProgress: Math.min(occupiedTokens, config.globalDailyTokenLimit),
    resetAt: usage.resetAt,
  }
}

function usageNumber(value: number): string {
  return usageNumberFormatter.format(value)
}

export function AdminWebChatPage() {
  const demo = !supabase
  const [config, setConfig] = useState<AdminWebChatConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      setConfig(await fetchAdminWebChatConfig())
    } catch (error) {
      setConfig(null)
      setNotice(error instanceof Error ? error.message : 'WebChat 配置读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const dailyUsage = useMemo(() => (config ? dailyUsageView(config) : null), [config])

  return (
    <div className="admin-page webchat-config-page" aria-busy={loading}>
      <section className="admin-page-heading">
        <div>
          <h1>WebChat 配置</h1>
          <p>只读核对遗留中转站状态、历史预算与成员用量。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示配置' : '生产配置'}</span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadConfig()}
            disabled={loading}
          >
            <RefreshCw
              className={loading ? 'is-spinning' : undefined}
              size={15}
              aria-hidden="true"
            />
            刷新
          </button>
        </div>
      </section>

      {notice ? (
        <p className="form-error admin-notice" role="alert">
          {notice}
        </p>
      ) : null}

      <AdminWebChatPilotPanel />

      {loading ? <LoadingState label="正在读取 WebChat 配置" /> : null}

      {!loading && !config ? (
        <EmptyState title="WebChat 配置暂不可用" description="请检查管理员权限后刷新重试。" />
      ) : null}

      {!loading && config ? (
        <>
          <section className="webchat-config-summary" aria-label="WebChat 配置状态">
            <div>
              <Power size={19} aria-hidden="true" />
              <span>产品状态</span>
              <strong>只读关闭</strong>
            </div>
            <div>
              <ShieldCheck size={19} aria-hidden="true" />
              <span>API Key</span>
              <strong>{config.apiKeyConfigured ? '已配置' : '未配置'}</strong>
            </div>
            <div>
              <RefreshCw size={19} aria-hidden="true" />
              <span>配置版本</span>
              <strong>v{config.version}</strong>
            </div>
            <div>
              <Gauge size={19} aria-hidden="true" />
              <span>每日总预算</span>
              <strong>
                {config.globalDailyRequestLimit.toLocaleString('zh-CN')} 次 /{' '}
                {config.globalDailyTokenLimit.toLocaleString('zh-CN')} Token
              </strong>
            </div>
            <div>
              <KeyRound size={19} aria-hidden="true" />
              <span>最近更新</span>
              <strong>
                {config.version === 0 ? '尚未配置' : formatDateTime(config.updatedAt)}
              </strong>
            </div>
          </section>

          {dailyUsage ? (
            <section className="webchat-daily-usage" aria-labelledby="webchat-daily-usage-title">
              <header className="webchat-daily-usage-heading">
                <div>
                  <h2 id="webchat-daily-usage-title">今日全站用量</h2>
                  <p>统计日期 {dailyUsage.usageDate}，仅汇总全站额度，不展示成员或请求明细。</p>
                </div>
                <span>
                  北京时间重置：
                  <strong>{beijingResetFormatter.format(new Date(dailyUsage.resetAt))}</strong>
                </span>
              </header>

              <div className="webchat-daily-usage-grid">
                <div className="webchat-usage-metric" role="group" aria-label="今日请求预算">
                  <div className="webchat-usage-metric-heading">
                    <span>请求</span>
                    <strong>
                      {usageNumber(dailyUsage.requestCount)} /{' '}
                      {usageNumber(dailyUsage.requestLimit)}
                    </strong>
                  </div>
                  <progress
                    aria-label="今日全站请求用量"
                    max={dailyUsage.requestLimit}
                    value={dailyUsage.requestProgress}
                  />
                  <dl className="webchat-usage-facts webchat-request-usage-facts">
                    <div>
                      <dt>已用</dt>
                      <dd>{usageNumber(dailyUsage.requestCount)}</dd>
                    </div>
                    <div>
                      <dt>上限</dt>
                      <dd>{usageNumber(dailyUsage.requestLimit)}</dd>
                    </div>
                    <div>
                      <dt>剩余</dt>
                      <dd>{usageNumber(dailyUsage.requestRemaining)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="webchat-usage-metric" role="group" aria-label="今日 Token 预算">
                  <div className="webchat-usage-metric-heading">
                    <span>Token</span>
                    <strong>
                      {usageNumber(dailyUsage.occupiedTokens)} /{' '}
                      {usageNumber(dailyUsage.tokenLimit)}
                    </strong>
                  </div>
                  <progress
                    aria-label="今日全站 Token 用量"
                    max={dailyUsage.tokenLimit}
                    value={dailyUsage.tokenProgress}
                  />
                  <dl className="webchat-usage-facts webchat-token-usage-facts">
                    <div>
                      <dt>已结算</dt>
                      <dd>{usageNumber(dailyUsage.settledTokens)}</dd>
                    </div>
                    <div>
                      <dt>正在预留</dt>
                      <dd>{usageNumber(dailyUsage.reservedTokens)}</dd>
                    </div>
                    <div>
                      <dt>已占用</dt>
                      <dd>{usageNumber(dailyUsage.occupiedTokens)}</dd>
                    </div>
                    <div>
                      <dt>上限</dt>
                      <dd>{usageNumber(dailyUsage.tokenLimit)}</dd>
                    </div>
                    <div>
                      <dt>剩余</dt>
                      <dd>{usageNumber(dailyUsage.tokenRemaining)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </section>
          ) : null}

          <section className="webchat-config-form" aria-labelledby="webchat-archive-title">
            <div className="form-section">
              <div className="webchat-config-section-heading">
                <div>
                  <h2 id="webchat-archive-title">遗留配置快照</h2>
                  <p>WebChat 已退出产品范围，配置、密钥、预算与请求开关均不可修改。</p>
                </div>
                <span className="status status-missing">只读关闭</span>
              </div>

              <dl className="webchat-usage-facts webchat-config-readonly-facts">
                <div>
                  <dt>数据库请求值</dt>
                  <dd>{config.requestsEnabled ? '遗留值为允许，运行入口仍关闭' : '已暂停'}</dd>
                </div>
                <div>
                  <dt>中转站 Base URL</dt>
                  <dd>{config.baseUrl || '未配置'}</dd>
                </div>
                <div>
                  <dt>模型</dt>
                  <dd>{config.model || '未配置'}</dd>
                </div>
                <div>
                  <dt>API Key</dt>
                  <dd>{config.apiKeyConfigured ? '已保存（不读取原值）' : '未配置'}</dd>
                </div>
                <div>
                  <dt>每日请求预算</dt>
                  <dd>{usageNumber(config.globalDailyRequestLimit)}</dd>
                </div>
                <div>
                  <dt>每日 Token 预算</dt>
                  <dd>{usageNumber(config.globalDailyTokenLimit)}</dd>
                </div>
              </dl>

              <div className="webchat-config-security-note">
                <KeyRound size={18} aria-hidden="true" />
                <p>页面只显示是否存在历史 Key，不读取原值，也不提供新增、替换或删除入口。</p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
