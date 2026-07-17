import BotMessageSquare from 'lucide-react/dist/esm/icons/bot-message-square'
import Gauge from 'lucide-react/dist/esm/icons/gauge'
import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
      <section className="assistant-intro" aria-labelledby="assistant-title">
        <div className="assistant-intro-copy">
          <p className="assistant-kicker">USTS ACM · AI LEARNING DESK</p>
          <h1 id="assistant-title">
            把卡住你的地方，
            <span>放到桌面上。</span>
          </h1>
          <p>
            用对话拆解题意、验证思路、调试代码与复盘训练。这里不是答案机器，而是一张帮助你把问题想清楚的算法工作台。
          </p>
        </div>
        <div className="assistant-intro-notes">
          <article>
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>赛中不用 AI</strong>
              <span>训练时用 AI 理清思路；正式算法竞赛期间请独立完成。</span>
            </div>
          </article>
          <article>
            <BotMessageSquare size={20} aria-hidden="true" />
            <div>
              <strong>MVP 临时会话</strong>
              <span>刷新页面会清空当前对话，本阶段不提供聊天历史。</span>
            </div>
          </article>
          <article>
            <KeyRound size={20} aria-hidden="true" />
            <div>
              <strong>不要提交秘密</strong>
              <span>请勿发送密码、Cookie、密钥、个人隐私或未公开代码。</span>
              <Link to="/privacy">查看 AI 隐私说明</Link>
            </div>
          </article>
        </div>
      </section>

      <section className="assistant-quota" aria-label="今日 AI 助手额度" aria-busy={usageLoading}>
        <div className="assistant-quota-heading">
          <Gauge size={20} aria-hidden="true" />
          <div>
            <strong>今日使用额度</strong>
            <span>
              {usage
                ? `统计日期 ${usage.usageDate} · 北京时间 ${new Date(usage.resetAt).toLocaleString(
                    'zh-CN',
                    {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    },
                  )} 重置`
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
                <dt>今日已用</dt>
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
            正在读取今日额度…
          </p>
        )}
      </section>

      {usage?.enabled ? <ChatRuntime onUsageChanged={() => loadUsage()} /> : null}
    </div>
  )
}
