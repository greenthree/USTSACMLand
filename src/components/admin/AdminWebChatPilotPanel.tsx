import Activity from 'lucide-react/dist/esm/icons/activity'
import Coins from 'lucide-react/dist/esm/icons/coins'
import DatabaseZap from 'lucide-react/dist/esm/icons/database-zap'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Users from 'lucide-react/dist/esm/icons/users'
import Zap from 'lucide-react/dist/esm/icons/zap'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAdminWebChatCacheSummary,
  fetchAdminWebChatPilotMembers,
  type AdminWebChatCacheSummary,
  type AdminWebChatPilotMember,
} from '../../lib/adminWebChatPilot'
import { formatDateTime } from '../../lib/format'
import { EmptyState } from '../EmptyState'
import { LoadingState } from '../LoadingState'

const numberFormatter = new Intl.NumberFormat('zh-CN')

function number(value: number): string {
  return numberFormatter.format(value)
}

export function AdminWebChatPilotPanel() {
  const [members, setMembers] = useState<AdminWebChatPilotMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cacheSummary, setCacheSummary] = useState<AdminWebChatCacheSummary | null>(null)
  const [cacheLoading, setCacheLoading] = useState(true)
  const [cacheError, setCacheError] = useState('')

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setMembers(await fetchAdminWebChatPilotMembers())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'AI 助手账号用量读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCacheSummary = useCallback(async () => {
    setCacheLoading(true)
    setCacheError('')
    try {
      setCacheSummary(await fetchAdminWebChatCacheSummary())
    } catch (loadError) {
      setCacheError(
        loadError instanceof Error ? loadError.message : 'WebChat 输入缓存摘要读取失败。',
      )
    } finally {
      setCacheLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMembers()
    void loadCacheSummary()
  }, [loadCacheSummary, loadMembers])

  const refreshAll = useCallback(() => {
    void loadMembers()
    void loadCacheSummary()
  }, [loadCacheSummary, loadMembers])

  const summary = useMemo(
    () => ({
      enabledMembers: members.filter(
        (member) => member.accessEnabled && member.accountStatus === 'approved',
      ).length,
      requestCount: members.reduce((total, member) => total + member.requestCount, 0),
      occupiedTokens: members.reduce(
        (total, member) => total + member.settledTokens + member.reservedTokens,
        0,
      ),
      activeRequests: members.reduce((total, member) => total + member.activeRequestCount, 0),
    }),
    [members],
  )

  return (
    <section
      className="admin-section webchat-pilot-section"
      aria-labelledby="webchat-pilot-title"
      aria-busy={loading || cacheLoading}
    >
      <header className="webchat-pilot-heading">
        <div>
          <h2 id="webchat-pilot-title">AI 助手账号与用量</h2>
          <p>集中查看成员权限、累计额度、剩余用量和脱敏活动状态。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={refreshAll}
          disabled={loading || cacheLoading}
        >
          <RefreshCw
            className={loading || cacheLoading ? 'is-spinning' : undefined}
            size={15}
            aria-hidden="true"
          />
          刷新用量
        </button>
      </header>

      {members.length > 0 ? (
        <div className="webchat-pilot-summary" aria-label="AI 助手账号摘要">
          <div>
            <Users size={18} aria-hidden="true" />
            <span>已配置账号</span>
            <strong>{number(members.length)}</strong>
          </div>
          <div>
            <Zap size={18} aria-hidden="true" />
            <span>当前可用</span>
            <strong>{number(summary.enabledMembers)}</strong>
          </div>
          <div>
            <Activity size={18} aria-hidden="true" />
            <span>累计请求</span>
            <strong>{number(summary.requestCount)}</strong>
          </div>
          <div>
            <Coins size={18} aria-hidden="true" />
            <span>累计占用 Token</span>
            <strong>{number(summary.occupiedTokens)}</strong>
          </div>
          <div>
            <RefreshCw size={18} aria-hidden="true" />
            <span>进行中请求</span>
            <strong>{number(summary.activeRequests)}</strong>
          </div>
        </div>
      ) : null}

      {cacheSummary ? (
        <div className="webchat-pilot-summary" aria-label="输入缓存摘要">
          <div>
            <DatabaseZap size={18} aria-hidden="true" />
            <span>可观测请求</span>
            <strong>{number(cacheSummary.observedRequests)}</strong>
          </div>
          <div>
            <Activity size={18} aria-hidden="true" />
            <span>达到缓存门槛</span>
            <strong>{number(cacheSummary.eligibleRequests)}</strong>
          </div>
          <div>
            <Zap size={18} aria-hidden="true" />
            <span>命中请求</span>
            <strong>
              {number(cacheSummary.cacheHitRequests)} / {number(cacheSummary.eligibleRequests)}
            </strong>
          </div>
          <div>
            <Coins size={18} aria-hidden="true" />
            <span>输入缓存率</span>
            <strong>
              {cacheSummary.eligibleInputTokens > 0
                ? `${((cacheSummary.cachedInputTokens / cacheSummary.eligibleInputTokens) * 100).toFixed(1)}%`
                : '0.0%'}
            </strong>
          </div>
          <div>
            <RefreshCw size={18} aria-hidden="true" />
            <span>缓存写入 Token</span>
            <strong>{number(cacheSummary.cacheWriteTokens)}</strong>
          </div>
        </div>
      ) : null}

      {cacheError ? (
        <div className="webchat-pilot-error" role="alert">
          <p>{cacheError}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadCacheSummary()}
          >
            重试缓存摘要
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="webchat-pilot-error" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void loadMembers()}>
            重试账号用量
          </button>
        </div>
      ) : null}

      {loading && members.length === 0 ? <LoadingState label="正在读取 AI 助手账号用量" /> : null}

      {!loading && !error && members.length === 0 ? (
        <EmptyState
          title="尚未配置 AI 助手账号"
          description="请进入成员详情开放 AI 助手权限并设置累计额度。"
        />
      ) : null}

      {members.length > 0 ? (
        <div className="compact-table-wrap admin-table-wrap webchat-pilot-table-wrap">
          <table className="compact-table admin-members-table webchat-pilot-table">
            <caption className="sr-only">WebChat 已配置账号累计用量与权限状态</caption>
            <thead>
              <tr>
                <th scope="col">成员</th>
                <th scope="col">年级 / 专业</th>
                <th scope="col">权限与状态</th>
                <th scope="col">累计请求</th>
                <th scope="col">累计 Token</th>
                <th scope="col">活动请求</th>
                <th scope="col">最近请求</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td data-label="成员">
                    <strong>{member.name}</strong>
                    <small>{member.role === 'admin' ? '管理员' : '成员'}</small>
                  </td>
                  <td data-label="年级 / 专业">
                    <span>{member.grade ?? '未填写年级'}</span>
                    <small>{member.major ?? '未填写专业'}</small>
                  </td>
                  <td data-label="权限与状态">
                    <span
                      className={`status ${member.accessEnabled ? 'status-fresh' : 'status-missing'}`}
                    >
                      {member.accessEnabled ? '已授权' : '已关闭'}
                    </span>
                    <small>
                      {member.accountStatus === 'approved' ? '账号正常' : '账号已停用'} · v
                      {member.version}
                    </small>
                  </td>
                  <td data-label="累计请求">
                    <strong>
                      {number(member.requestCount)} / {number(member.totalRequestLimit)}
                    </strong>
                    <small>剩余 {number(member.remainingRequests)}</small>
                  </td>
                  <td data-label="累计 Token">
                    <strong>
                      {number(member.settledTokens + member.reservedTokens)} /{' '}
                      {number(member.totalTokenLimit)}
                    </strong>
                    <small>
                      已结算 {number(member.settledTokens)} · 预留 {number(member.reservedTokens)} ·
                      剩余 {number(member.remainingTokens)}
                    </small>
                  </td>
                  <td data-label="活动请求">
                    <strong>{number(member.activeRequestCount)}</strong>
                    <small>当前正在生成</small>
                  </td>
                  <td data-label="最近请求">
                    <span>
                      {member.lastRequestAt ? formatDateTime(member.lastRequestAt) : '尚未请求'}
                    </span>
                    <small>权限更新 {formatDateTime(member.updatedAt)}</small>
                  </td>
                  <td data-label="操作">
                    <Link className="table-link" to={`/admin/members/${member.id}`}>
                      查看详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
