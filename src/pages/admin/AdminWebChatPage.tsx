import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import Gauge from 'lucide-react/dist/esm/icons/gauge'
import Power from 'lucide-react/dist/esm/icons/power'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Save from 'lucide-react/dist/esm/icons/save'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { AdminWebChatPilotPanel } from '../../components/admin/AdminWebChatPilotPanel'
import {
  AdminWebChatConfigError,
  fetchAdminWebChatConfig,
  type AdminWebChatConfig,
  updateAdminWebChatConfig,
} from '../../lib/adminWebChatConfig'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'

const conflictCodes = new Set(['version_conflict', 'config_conflict', 'conflict'])
const relayModelPattern = /^[A-Za-z0-9._:/-]{1,128}$/
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

function validRelayUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const normalizedPath = url.pathname.replace(/\/+$/, '').toLocaleLowerCase('en-US')
    return (
      url.protocol === 'https:' &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !normalizedPath.endsWith('/responses')
    )
  } catch {
    return false
  }
}

export function AdminWebChatPage() {
  const demo = !supabase
  const [config, setConfig] = useState<AdminWebChatConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [requestsEnabled, setRequestsEnabled] = useState(false)
  const [globalDailyRequestLimit, setGlobalDailyRequestLimit] = useState('300')
  const [globalDailyTokenLimit, setGlobalDailyTokenLimit] = useState('1000000')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')

  const applyConfig = useCallback((nextConfig: AdminWebChatConfig) => {
    setConfig(nextConfig)
    setBaseUrl(nextConfig.baseUrl)
    setModel(nextConfig.model)
    setRequestsEnabled(nextConfig.requestsEnabled)
    setGlobalDailyRequestLimit(String(nextConfig.globalDailyRequestLimit))
    setGlobalDailyTokenLimit(String(nextConfig.globalDailyTokenLimit))
  }, [])

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setNotice('')
    setApiKey('')
    try {
      applyConfig(await fetchAdminWebChatConfig())
    } catch (error) {
      setConfig(null)
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : 'WebChat 配置读取失败。')
    } finally {
      setLoading(false)
    }
  }, [applyConfig])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const hasChanges = useMemo(
    () =>
      config !== null &&
      (baseUrl.trim() !== config.baseUrl ||
        model.trim() !== config.model ||
        requestsEnabled !== config.requestsEnabled ||
        Number(globalDailyRequestLimit) !== config.globalDailyRequestLimit ||
        Number(globalDailyTokenLimit) !== config.globalDailyTokenLimit ||
        apiKey.trim().length > 0),
    [
      apiKey,
      baseUrl,
      config,
      globalDailyRequestLimit,
      globalDailyTokenLimit,
      model,
      requestsEnabled,
    ],
  )
  const dailyUsage = useMemo(() => (config ? dailyUsageView(config) : null), [config])

  async function refreshAfterConflict(error: AdminWebChatConfigError) {
    try {
      applyConfig(await fetchAdminWebChatConfig())
      setNotice(`${error.message}，已载入最新版本，请重新填写后保存。`)
    } catch (reloadError) {
      setNotice(
        `${error.message}；${reloadError instanceof Error ? reloadError.message : '最新配置读取失败。'}`,
      )
    }
  }

  async function submitConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!config) return

    const normalizedBaseUrl = baseUrl.trim()
    const normalizedModel = model.trim()
    const normalizedReason = reason.trim()
    const replacementApiKey = apiKey.trim()
    const normalizedGlobalDailyRequestLimit = Number(globalDailyRequestLimit)
    const normalizedGlobalDailyTokenLimit = Number(globalDailyTokenLimit)

    if (
      !normalizedBaseUrl ||
      normalizedBaseUrl.length > 2_048 ||
      !validRelayUrl(normalizedBaseUrl)
    ) {
      setNoticeKind('error')
      setNotice('请输入有效的 HTTPS 中转站 Base URL。')
      return
    }
    if (!relayModelPattern.test(normalizedModel)) {
      setNoticeKind('error')
      setNotice('模型名称需包含 1 到 128 个字母、数字或 . _ : / - 字符。')
      return
    }
    if (
      !Number.isSafeInteger(normalizedGlobalDailyRequestLimit) ||
      normalizedGlobalDailyRequestLimit < 1 ||
      normalizedGlobalDailyRequestLimit > 1_000_000
    ) {
      setNoticeKind('error')
      setNotice('全站每日请求上限需为 1 到 1,000,000 的整数。')
      return
    }
    if (
      !Number.isSafeInteger(normalizedGlobalDailyTokenLimit) ||
      normalizedGlobalDailyTokenLimit < 100 ||
      normalizedGlobalDailyTokenLimit > 1_000_000_000
    ) {
      setNoticeKind('error')
      setNotice('全站每日 Token 上限需为 100 到 1,000,000,000 的整数。')
      return
    }
    if (replacementApiKey.length > 0 && /\s/.test(replacementApiKey)) {
      setNoticeKind('error')
      setNotice('新的 API Key 不能包含空白字符。')
      return
    }
    if (replacementApiKey.length > 0 && replacementApiKey.length < 16) {
      setNoticeKind('error')
      setNotice('新的 API Key 至少需要 16 个字符。')
      return
    }
    if (!config.apiKeyConfigured && replacementApiKey.length < 16) {
      setNoticeKind('error')
      setNotice('首次配置必须填写至少 16 个字符的 API Key。')
      return
    }
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      setNoticeKind('error')
      setNotice('修改原因需包含 3 到 500 个字符。')
      return
    }
    if (!hasChanges) {
      setNoticeKind('error')
      setNotice('当前没有需要保存的配置变更。')
      return
    }

    setSaving(true)
    setNotice('')
    // Clear the secret field before the network request settles. The submitted
    // value is never copied into localStorage/sessionStorage or returned by the API.
    setApiKey('')
    try {
      const nextConfig = await updateAdminWebChatConfig({
        baseUrl: normalizedBaseUrl,
        model: normalizedModel,
        ...(replacementApiKey ? { apiKey: replacementApiKey } : {}),
        requestsEnabled,
        globalDailyRequestLimit: normalizedGlobalDailyRequestLimit,
        globalDailyTokenLimit: normalizedGlobalDailyTokenLimit,
        expectedVersion: config.version,
        reason: normalizedReason,
      })
      applyConfig(nextConfig)
      setReason('')
      setNoticeKind('success')
      setNotice('WebChat 中转站配置已保存。')
    } catch (error) {
      setNoticeKind('error')
      if (error instanceof AdminWebChatConfigError && error.code && conflictCodes.has(error.code)) {
        await refreshAfterConflict(error)
      } else {
        setNotice(error instanceof Error ? error.message : 'WebChat 配置保存失败。')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-page webchat-config-page" aria-busy={loading || saving}>
      <section className="admin-page-heading">
        <div>
          <h1>WebChat 配置</h1>
          <p>管理 AI 学习助手的中转站、服务端密钥、运行开关和全站每日预算。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示配置' : '生产配置'}</span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadConfig()}
            disabled={loading || saving}
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
        <p
          className={`form-${noticeKind} admin-notice`}
          role={noticeKind === 'error' ? 'alert' : 'status'}
        >
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
              <span>成员请求</span>
              <strong>{config.requestsEnabled ? '允许' : '已暂停'}</strong>
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

          <form className="webchat-config-form" onSubmit={submitConfig}>
            <section className="form-section">
              <div className="webchat-config-section-heading">
                <div>
                  <h2>中转站连接</h2>
                  <p>这些值只在服务端使用；模型与地址不会由聊天页面覆盖。</p>
                </div>
                <span
                  className={
                    config.apiKeyConfigured ? 'status status-verified' : 'status status-missing'
                  }
                >
                  {config.apiKeyConfigured ? '密钥可用' : '等待密钥'}
                </span>
              </div>

              <div className="form-grid webchat-config-fields">
                <label className="span-two webchat-config-toggle">
                  <input
                    type="checkbox"
                    checked={requestsEnabled}
                    disabled={saving}
                    onChange={(event) => setRequestsEnabled(event.target.checked)}
                  />
                  <span>
                    <strong>允许成员发起 AI 请求</strong>
                    <small>
                      关闭后数据库配置立即拒绝新请求；服务端 CHAT_ENABLED=false
                      仍是更高优先级的总开关。
                    </small>
                  </span>
                </label>

                <label className="span-two">
                  <span>中转站 Base URL</span>
                  <input
                    required
                    type="url"
                    maxLength={2_048}
                    placeholder="https://relay.example.com/v1"
                    value={baseUrl}
                    disabled={saving}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                  <small>填写提供 OpenAI Responses API 的完整服务根地址。</small>
                </label>

                <label>
                  <span>全站每日请求上限</span>
                  <input
                    required
                    type="number"
                    min={1}
                    max={1_000_000}
                    step={1}
                    value={globalDailyRequestLimit}
                    disabled={saving}
                    onChange={(event) => setGlobalDailyRequestLimit(event.target.value)}
                  />
                  <small>北京时间每日 00:00 重置，所有成员共同消耗。</small>
                </label>

                <label>
                  <span>全站每日 Token 上限</span>
                  <input
                    required
                    type="number"
                    min={100}
                    max={1_000_000_000}
                    step={100}
                    value={globalDailyTokenLimit}
                    disabled={saving}
                    onChange={(event) => setGlobalDailyTokenLimit(event.target.value)}
                  />
                  <small>包含已结算 Token 与正在生成请求的保守预留额度。</small>
                </label>

                <label>
                  <span>模型</span>
                  <input
                    required
                    maxLength={128}
                    placeholder="gpt-5.6"
                    value={model}
                    disabled={saving}
                    onChange={(event) => setModel(event.target.value)}
                  />
                  <small>所有成员统一使用该服务端固定模型。</small>
                </label>

                <label>
                  <span>
                    {config.apiKeyConfigured ? '替换 API Key（可选）' : 'API Key（首次配置必填）'}
                  </span>
                  <input
                    required={!config.apiKeyConfigured}
                    type="password"
                    name="webchat-api-key"
                    autoComplete="new-password"
                    minLength={16}
                    maxLength={4_096}
                    placeholder={
                      config.apiKeyConfigured ? '留空保持当前密钥' : '输入新的服务端密钥'
                    }
                    value={apiKey}
                    disabled={saving}
                    spellCheck={false}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <small>留空不会删除原密钥；旧 Key 永不回显，提交后此输入框立即清空。</small>
                </label>

                <label className="span-two">
                  <span>修改原因</span>
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    rows={4}
                    placeholder="说明本次地址、模型或密钥变更的原因"
                    value={reason}
                    disabled={saving}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <small>原因会与操作者、配置版本和更新时间一起进入后台审计记录。</small>
                </label>
              </div>

              <div className="webchat-config-security-note">
                <KeyRound size={18} aria-hidden="true" />
                <p>
                  页面只能看到“是否已配置”，永远不会读取现有 API Key。新密钥仅随本次请求提交，
                  不写入 localStorage 或 sessionStorage。
                </p>
              </div>

              <div className="form-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    saving ||
                    !hasChanges ||
                    reason.trim().length < 3 ||
                    ((!config.apiKeyConfigured || apiKey.trim().length > 0) &&
                      apiKey.trim().length < 16)
                  }
                >
                  <Save size={16} aria-hidden="true" />
                  {saving ? '保存中' : '保存配置'}
                </button>
              </div>
            </section>
          </form>
        </>
      ) : null}
    </div>
  )
}
