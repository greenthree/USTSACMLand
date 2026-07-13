import Ban from 'lucide-react/dist/esm/icons/ban'
import Check from 'lucide-react/dist/esm/icons/check'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Search from 'lucide-react/dist/esm/icons/search'
import X from 'lucide-react/dist/esm/icons/x'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { PlatformMark } from '../../components/PlatformMark'
import { mockAdminPlatformAccounts } from '../../data/mock'
import { triggerAdminImmediateSync } from '../../lib/adminImmediateSync'
import { formatDateTime } from '../../lib/format'
import {
  fetchAdminPlatformAccounts,
  setAdminPlatformAccountStatus,
} from '../../lib/adminPlatformAccounts'
import { platformLabels, platformUrls } from '../../lib/platforms'
import { supabase } from '../../lib/supabase'
import {
  platforms,
  type AccountVerificationStatus,
  type AdminPlatformAccount,
  type Platform,
} from '../../types/domain'

const statusLabels: Record<AccountVerificationStatus, string> = {
  pending: '待验证',
  verified: '已验证',
  invalid: '无效',
  disabled: '已停用',
}

function AccountStatusBadge({ status }: { status: AccountVerificationStatus }) {
  return <span className={`status status-${status}`}>{statusLabels[status]}</span>
}

function displayTime(value: string | null): string {
  return value ? formatDateTime(value) : '--'
}

export function AdminAccountsPage() {
  const demo = !supabase
  const [accounts, setAccounts] = useState<AdminPlatformAccount[]>(() =>
    demo ? mockAdminPlatformAccounts : [],
  )
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [status, setStatus] = useState<AccountVerificationStatus | 'all'>('all')
  const [loading, setLoading] = useState(!demo)
  const [busyAccountIds, setBusyAccountIds] = useState<ReadonlySet<number>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [invalidAccount, setInvalidAccount] = useState<AdminPlatformAccount | null>(null)
  const [invalidReason, setInvalidReason] = useState('')
  const [disabledAccount, setDisabledAccount] = useState<AdminPlatformAccount | null>(null)

  const loadAccounts = useCallback(async () => {
    if (demo) return

    setLoading(true)
    setNotice('')
    try {
      setAccounts(await fetchAdminPlatformAccounts())
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '平台账号列表读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    return accounts.filter(
      (account) =>
        (platform === 'all' || account.platform === platform) &&
        (status === 'all' || account.status === status) &&
        (normalizedQuery.length === 0 ||
          account.memberName.toLocaleLowerCase('zh-CN').includes(normalizedQuery) ||
          account.email.toLocaleLowerCase('en-US').includes(normalizedQuery) ||
          account.externalId.toLocaleLowerCase('en-US').includes(normalizedQuery)),
    )
  }, [accounts, platform, query, status])

  async function updateStatus(
    account: AdminPlatformAccount,
    nextStatus: AccountVerificationStatus,
    errorMessage: string | null = null,
  ) {
    setBusyAccountIds((current) => new Set(current).add(account.id))
    setNotice('')

    try {
      await setAdminPlatformAccountStatus(account.id, nextStatus, errorMessage, account.updatedAt)
      if (demo) {
        const now = new Date().toISOString()
        setAccounts((current) =>
          current.map((item) =>
            item.id === account.id
              ? {
                  ...item,
                  status: nextStatus,
                  verifiedAt: nextStatus === 'verified' ? now : null,
                  verificationErrorCode: nextStatus === 'invalid' ? 'invalid_account' : null,
                  verificationErrorMessage: nextStatus === 'invalid' ? errorMessage : null,
                  updatedAt: now,
                }
              : item,
          ),
        )
      } else {
        setAccounts(await fetchAdminPlatformAccounts())
      }
      const successNotice = `${account.memberName} 的 ${platformLabels[account.platform]} 账号已更新为“${statusLabels[nextStatus]}”。`
      setNoticeKind('success')
      setNotice(successNotice)

      if (nextStatus === 'verified') {
        try {
          await triggerAdminImmediateSync({
            memberId: account.profileId,
            platforms: [account.platform],
            triggerType: 'account_changed',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知同步错误'
          setNoticeKind('error')
          setNotice(`${successNotice} 首次同步失败：${message}。`)
        }
      }
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '平台账号审核失败。')
    } finally {
      setBusyAccountIds((current) => {
        const next = new Set(current)
        next.delete(account.id)
        return next
      })
    }
  }

  function openInvalidDialog(account: AdminPlatformAccount) {
    setInvalidAccount(account)
    setInvalidReason(account.verificationErrorMessage ?? '')
  }

  function submitInvalid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invalidAccount) return
    const reason = invalidReason.trim()
    if (!reason) return

    const account = invalidAccount
    setInvalidAccount(null)
    setInvalidReason('')
    void updateStatus(account, 'invalid', reason)
  }

  function submitDisabled(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!disabledAccount) return

    const account = disabledAccount
    setDisabledAccount(null)
    void updateStatus(account, 'disabled')
  }

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <h1>平台账号审核</h1>
          <p>核验成员的平台绑定；XCPC ELO 按姓名与学校自动匹配，由同步服务维护。</p>
        </div>
        <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
      </section>

      <div className="admin-toolbar">
        <label className="search-field wide-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索成员、邮箱或平台账号</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索成员、邮箱或平台账号"
          />
        </label>
        <div className="filter-group">
          <label className="select-field">
            <span className="sr-only">平台</span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform | 'all')}
            >
              <option value="all">全部平台</option>
              {platforms.map((item) => (
                <option key={item} value={item}>
                  {platformLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span className="sr-only">账号状态</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as AccountVerificationStatus | 'all')
              }
            >
              <option value="all">全部状态</option>
              <option value="pending">待验证</option>
              <option value="verified">已验证</option>
              <option value="invalid">无效</option>
              <option value="disabled">已停用</option>
            </select>
          </label>
        </div>
      </div>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取平台账号列表" /> : null}

      {!loading && filteredAccounts.length === 0 ? (
        <EmptyState title="没有匹配的平台账号" description="调整搜索词、平台或状态后重试。" />
      ) : null}

      {!loading && filteredAccounts.length > 0 ? (
        <div className="compact-table-wrap admin-table-wrap">
          <table className="compact-table admin-members-table admin-accounts-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>平台</th>
                <th>平台账号</th>
                <th>状态</th>
                <th>最近错误</th>
                <th>更新时间</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => {
                const busy = busyAccountIds.has(account.id)
                return (
                  <tr aria-busy={busy} key={account.id}>
                    <td data-label="成员">
                      <strong>{account.memberName}</strong>
                      <small>{account.email}</small>
                      <small>{account.major}</small>
                    </td>
                    <td data-label="平台">
                      <PlatformMark platform={account.platform} />
                    </td>
                    <td data-label="平台账号">
                      {account.platform === 'xcpc_elo' ? (
                        <span className="admin-auto-match-account">
                          <strong>按姓名自动匹配</strong>
                          <small title={account.externalId}>内部 ID：{account.externalId}</small>
                        </span>
                      ) : (
                        <a
                          className="admin-account-link"
                          href={platformUrls[account.platform](account.externalId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className={account.externalId.length > 16 ? 'is-long' : undefined}>
                            {account.externalId}
                          </span>
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      )}
                    </td>
                    <td data-label="状态">
                      <AccountStatusBadge status={account.status} />
                    </td>
                    <td data-label="最近错误">
                      {account.verificationErrorMessage ? (
                        <span className="admin-account-error">
                          {account.verificationErrorCode ? (
                            <small>{account.verificationErrorCode}</small>
                          ) : null}
                          {account.verificationErrorMessage}
                        </span>
                      ) : (
                        '--'
                      )}
                    </td>
                    <td data-label="更新时间">
                      <span className="admin-account-time">
                        {formatDateTime(account.updatedAt)}
                        <small>验证：{displayTime(account.verifiedAt)}</small>
                      </span>
                    </td>
                    <td data-label="操作">
                      {account.platform === 'xcpc_elo' ? (
                        <span className="automatic-account-note">同步服务自动维护</span>
                      ) : (
                        <div className="row-actions">
                          {account.status !== 'verified' ? (
                            <button
                              className="icon-button approve-button"
                              type="button"
                              title="标记为已验证"
                              aria-label={`验证 ${account.memberName} 的 ${platformLabels[account.platform]} 账号`}
                              disabled={busy}
                              onClick={() => void updateStatus(account, 'verified')}
                            >
                              <Check size={16} />
                            </button>
                          ) : null}
                          {account.status !== 'invalid' ? (
                            <button
                              className="icon-button reject-button"
                              type="button"
                              title="标记为无效"
                              aria-label={`标记 ${account.memberName} 的 ${platformLabels[account.platform]} 账号无效`}
                              disabled={busy}
                              onClick={() => openInvalidDialog(account)}
                            >
                              <X size={16} />
                            </button>
                          ) : null}
                          {account.status !== 'disabled' ? (
                            <button
                              className="icon-button suspend-button"
                              type="button"
                              title="停用账号"
                              aria-label={`停用 ${account.memberName} 的 ${platformLabels[account.platform]} 账号`}
                              disabled={busy}
                              onClick={() => setDisabledAccount(account)}
                            >
                              <Ban size={16} />
                            </button>
                          ) : null}
                          {account.status !== 'pending' ? (
                            <button
                              className="icon-button"
                              type="button"
                              title="恢复为待验证"
                              aria-label={`恢复 ${account.memberName} 的 ${platformLabels[account.platform]} 账号为待验证`}
                              disabled={busy}
                              onClick={() => void updateStatus(account, 'pending')}
                            >
                              <RotateCcw size={16} />
                            </button>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {invalidAccount ? (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setInvalidAccount(null)
          }}
        >
          <section
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invalid-account-dialog-title"
          >
            <form onSubmit={submitInvalid}>
              <div className="admin-dialog-header">
                <h2 id="invalid-account-dialog-title">
                  标记 {invalidAccount.memberName} 的 {platformLabels[invalidAccount.platform]}{' '}
                  账号无效
                </h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭无效账号对话框"
                  onClick={() => setInvalidAccount(null)}
                >
                  <X size={17} />
                </button>
              </div>
              <label className="admin-dialog-field">
                <span>无效原因</span>
                <textarea
                  autoFocus
                  required
                  maxLength={2000}
                  rows={4}
                  value={invalidReason}
                  onChange={(event) => setInvalidReason(event.target.value)}
                />
              </label>
              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setInvalidAccount(null)}
                >
                  取消
                </button>
                <button
                  className="primary-button reject-confirm-button"
                  type="submit"
                  disabled={!invalidReason.trim()}
                >
                  <X size={16} aria-hidden="true" />
                  确认无效
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {disabledAccount ? (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDisabledAccount(null)
          }}
        >
          <section
            className="admin-dialog admin-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="disable-account-dialog-title"
          >
            <form onSubmit={submitDisabled}>
              <div className="admin-dialog-header">
                <h2 id="disable-account-dialog-title">
                  停用 {disabledAccount.memberName} 的 {platformLabels[disabledAccount.platform]}{' '}
                  账号
                </h2>
              </div>
              <p>停用后该账号不会进入公开榜单或定时同步，可稍后恢复为待验证。</p>
              <div className="admin-dialog-actions">
                <button
                  autoFocus
                  className="secondary-button"
                  type="button"
                  onClick={() => setDisabledAccount(null)}
                >
                  取消
                </button>
                <button className="primary-button suspend-confirm-button" type="submit">
                  <Ban size={16} aria-hidden="true" />
                  确认停用
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
