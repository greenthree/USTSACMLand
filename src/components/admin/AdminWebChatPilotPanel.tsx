import Activity from 'lucide-react/dist/esm/icons/activity'
import Coins from 'lucide-react/dist/esm/icons/coins'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Users from 'lucide-react/dist/esm/icons/users'
import Zap from 'lucide-react/dist/esm/icons/zap'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAdminWebChatPilotMembers,
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

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setMembers(await fetchAdminWebChatPilotMembers())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '试运行成员用量读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

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
      aria-busy={loading}
    >
      <header className="webchat-pilot-heading">
        <div>
          <h2 id="webchat-pilot-title">试运行成员</h2>
          <p>仅汇总已显式配置 AI 权限账号的累计额度与活动状态，不读取对话内容。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void loadMembers()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'is-spinning' : undefined} size={15} aria-hidden="true" />
          刷新用量
        </button>
      </header>

      {members.length > 0 ? (
        <div className="webchat-pilot-summary" aria-label="试运行摘要">
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

      {error ? (
        <div className="webchat-pilot-error" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void loadMembers()}>
            重试观测数据
          </button>
        </div>
      ) : null}

      {loading && members.length === 0 ? <LoadingState label="正在读取试运行成员用量" /> : null}

      {!loading && !error && members.length === 0 ? (
        <EmptyState
          title="尚未配置试运行成员"
          description="请先进入成员详情，为 3–5 名成员显式开启 AI 助手权限并设置额度。"
        />
      ) : null}

      {members.length > 0 ? (
        <div className="compact-table-wrap admin-table-wrap webchat-pilot-table-wrap">
          <table className="compact-table admin-members-table webchat-pilot-table">
            <caption className="sr-only">WebChat 试运行成员累计用量</caption>
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
