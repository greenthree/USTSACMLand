import Gauge from 'lucide-react/dist/esm/icons/gauge'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import { useCallback, useEffect, useState } from 'react'
import { ChatRuntime } from '../features/chat/ChatRuntime'
import '../features/chat/chat.css'
import { formatInteger } from '../lib/format'
import { fetchOwnWebChatUsage, type WebChatMemberUsage } from '../lib/webChatMemberAccess'

export function AssistantPage() {
  const [usage, setUsage] = useState<WebChatMemberUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState('')

  const loadUsage = useCallback(async (showLoading = false) => {
    if (showLoading) setUsageLoading(true)
    setUsageError('')
    try {
      setUsage(await fetchOwnWebChatUsage())
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : 'AI 助手额度读取失败。')
    } finally {
      setUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsage(true)
  }, [loadUsage])

  return (
    <div className="assistant-page">
      <section className="assistant-quota" aria-label="AI 助手累计额度" aria-busy={usageLoading}>
        <div className="assistant-quota-heading">
          <Gauge size={20} aria-hidden="true" />
          <div>
            <strong>累计使用额度</strong>
            <span>
              {usage
                ? `当前模型 ${usage.model ?? '未配置'} · 额度由管理员设定，不会每日重置`
                : '正在读取成员授权与额度'}
            </span>
          </div>
          <button
            type="button"
            title="刷新额度"
            aria-label="刷新 AI 助手额度"
            disabled={usageLoading}
            onClick={() => void loadUsage(true)}
          >
            <RefreshCw className={usageLoading ? 'is-spinning' : undefined} size={16} />
          </button>
        </div>

        {usageError ? (
          <div className="assistant-quota-error" role="status">
            <span>{usageError}</span>
            <button type="button" onClick={() => void loadUsage(true)}>
              重试
            </button>
          </div>
        ) : usage?.enabled ? (
          <div className="assistant-quota-metrics">
            <dl>
              <div>
                <dt>剩余请求</dt>
                <dd>
                  {formatInteger(usage.requests.remaining)}
                  <small>/ {formatInteger(usage.requests.limit)}</small>
                </dd>
              </div>
              <div>
                <dt>累计已用</dt>
                <dd>{formatInteger(usage.requests.used)}</dd>
              </div>
            </dl>
            <dl>
              <div>
                <dt>剩余 Token</dt>
                <dd>
                  {formatInteger(usage.tokens.remaining)}
                  <small>/ {formatInteger(usage.tokens.limit)}</small>
                </dd>
              </div>
              <div>
                <dt>已结算 / 预留</dt>
                <dd>
                  {formatInteger(usage.tokens.settled)}
                  <small> / {formatInteger(usage.tokens.reserved)}</small>
                </dd>
              </div>
            </dl>
          </div>
        ) : usage ? (
          <p className="assistant-access-denied" role="status">
            当前账号尚未开通 AI 学习助手，请联系集训队管理员加入试运行。
          </p>
        ) : (
          <p className="assistant-quota-loading" role="status">
            正在读取累计额度…
          </p>
        )}
      </section>

      {usage?.enabled ? <ChatRuntime onUsageChanged={() => loadUsage()} /> : null}
    </div>
  )
}
