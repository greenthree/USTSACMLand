import Ban from 'lucide-react/dist/esm/icons/ban'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Search from 'lucide-react/dist/esm/icons/search'
import X from 'lucide-react/dist/esm/icons/x'
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { mockAdminMembers } from '../../data/mock'
import { fetchAdminMembers, setAdminMemberSuspension } from '../../lib/adminMembers'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { AdminMember, AdminMemberStatus } from '../../types/domain'

const memberStatusLabels: Record<AdminMemberStatus, string> = {
  active: '正常',
  suspended: '已停用',
}

function MemberStatusBadge({ status }: { status: AdminMemberStatus }) {
  const className = status === 'active' ? 'status-verified' : 'status-suspended'
  return <span className={`status ${className}`}>{memberStatusLabels[status]}</span>
}

export function AdminMembersPage() {
  const demo = !supabase
  const [members, setMembers] = useState<AdminMember[]>(() => (demo ? mockAdminMembers : []))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AdminMemberStatus | 'all'>('all')
  const [loading, setLoading] = useState(!demo)
  const [busyMemberIds, setBusyMemberIds] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [suspensionMember, setSuspensionMember] = useState<AdminMember | null>(null)
  const [suspensionNote, setSuspensionNote] = useState('')
  const suspensionDialogRef = useRef<HTMLElement | null>(null)
  const suspensionTriggerRef = useRef<HTMLElement | null>(null)

  const loadMembers = useCallback(async () => {
    if (demo) return

    setLoading(true)
    setNotice('')
    try {
      setMembers(await fetchAdminMembers())
    } catch (error) {
      setMembers([])
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '成员列表读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    return members.filter(
      (member) =>
        (status === 'all' || member.status === status) &&
        (normalizedQuery.length === 0 ||
          member.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery) ||
          member.email.toLocaleLowerCase('en-US').includes(normalizedQuery) ||
          member.qq.includes(normalizedQuery) ||
          member.major.toLocaleLowerCase('zh-CN').includes(normalizedQuery) ||
          member.grade.includes(normalizedQuery)),
    )
  }, [members, query, status])

  async function updateSuspension(
    member: AdminMember,
    suspended: boolean,
    note: string | null = null,
  ) {
    setBusyMemberIds((current) => new Set(current).add(member.id))
    setNotice('')

    try {
      const updatedAt = await setAdminMemberSuspension(member.id, suspended, member.updatedAt, note)
      const nextStatus: AdminMemberStatus = suspended ? 'suspended' : 'active'
      setMembers((current) =>
        current.map((item) =>
          item.id === member.id
            ? {
                ...item,
                status: nextStatus,
                suspensionNote: suspended ? note : null,
                updatedAt,
              }
            : item,
        ),
      )
      setNoticeKind('success')
      setNotice(`${member.name} 已${suspended ? '停用' : '恢复'}。`)
    } catch (error) {
      if (!demo) await loadMembers()
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '成员状态更新失败。')
    } finally {
      setBusyMemberIds((current) => {
        const next = new Set(current)
        next.delete(member.id)
        return next
      })
    }
  }

  function openSuspensionDialog(member: AdminMember) {
    const activeElement = document.activeElement
    suspensionTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null
    setSuspensionMember(member)
    setSuspensionNote('')
  }

  function closeSuspensionDialog() {
    setSuspensionMember(null)
    setSuspensionNote('')
    const trigger = suspensionTriggerRef.current
    suspensionTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }

  function handleSuspensionDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSuspensionDialog()
      return
    }

    if (event.key !== 'Tab') return

    const focusableElements = Array.from(
      suspensionDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    if (focusableElements.length === 0) return

    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function submitSuspension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!suspensionMember) return

    const member = suspensionMember
    const note = suspensionNote.trim() || null
    closeSuspensionDialog()
    void updateSuspension(member, true, note)
  }

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <h1>成员管理</h1>
          <p>查看成员资料与平台绑定，并管理公开参榜和数据同步资格。</p>
        </div>
        <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
      </section>

      <div className="admin-toolbar">
        <label className="search-field wide-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索成员、邮箱、QQ、年级或专业</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索成员、邮箱、QQ、年级或专业"
          />
        </label>
        <label className="select-field plain-select">
          <span className="sr-only">成员状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminMemberStatus | 'all')}
          >
            <option value="all">全部状态</option>
            <option value="active">正常</option>
            <option value="suspended">已停用</option>
          </select>
        </label>
      </div>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取成员列表" /> : null}

      {!loading && filteredMembers.length === 0 ? (
        <EmptyState title="没有匹配的成员" description="调整搜索词或成员状态后重试。" />
      ) : null}

      {!loading && filteredMembers.length > 0 ? (
        <div className="compact-table-wrap admin-table-wrap">
          <table className="compact-table admin-members-table admin-member-management-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>年级</th>
                <th>专业</th>
                <th>QQ</th>
                <th>平台账号</th>
                <th>公开</th>
                <th>状态</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => {
                const busy = busyMemberIds.has(member.id)
                return (
                  <tr aria-busy={busy} key={member.id}>
                    <td data-label="成员">
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                      <small>{formatDateTime(member.joinedAt)} 注册</small>
                      {member.suspensionNote ? (
                        <small>停用原因：{member.suspensionNote}</small>
                      ) : null}
                    </td>
                    <td data-label="年级">{member.grade}</td>
                    <td data-label="专业">{member.major}</td>
                    <td data-label="QQ">{member.qq}</td>
                    <td data-label="平台账号">
                      <span className="admin-member-platform-count">
                        <strong>{member.verifiedPlatformCount}</strong>
                        <small>/ {member.platformCount} 已验证</small>
                      </span>
                    </td>
                    <td data-label="公开">
                      <span className="admin-member-visibility">
                        {member.isPublic ? '允许公开' : '不公开'}
                      </span>
                    </td>
                    <td data-label="状态">
                      <MemberStatusBadge status={member.status} />
                    </td>
                    <td data-label="操作">
                      <div className="row-actions">
                        {member.status === 'active' ? (
                          <button
                            className="icon-button suspend-button"
                            type="button"
                            title="停用成员"
                            aria-label={`停用 ${member.name}`}
                            disabled={busy}
                            onClick={() => openSuspensionDialog(member)}
                          >
                            <Ban size={16} />
                          </button>
                        ) : (
                          <button
                            className="icon-button"
                            type="button"
                            title="恢复成员"
                            aria-label={`恢复 ${member.name}`}
                            disabled={busy}
                            onClick={() => void updateSuspension(member, false)}
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {suspensionMember ? (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeSuspensionDialog()
          }}
        >
          <section
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspend-member-dialog-title"
            ref={suspensionDialogRef}
            onKeyDown={handleSuspensionDialogKeyDown}
          >
            <form onSubmit={submitSuspension}>
              <div className="admin-dialog-header">
                <h2 id="suspend-member-dialog-title">停用 {suspensionMember.name}</h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭停用成员对话框"
                  onClick={closeSuspensionDialog}
                >
                  <X size={17} />
                </button>
              </div>
              <p>
                停用后该成员会退出公开榜单和定时同步，并且无法修改资料或平台绑定；仍可登录查看公开页面。
              </p>
              <label className="admin-dialog-field">
                <span>停用原因（可选）</span>
                <textarea
                  autoFocus
                  maxLength={1000}
                  rows={3}
                  value={suspensionNote}
                  onChange={(event) => setSuspensionNote(event.target.value)}
                />
              </label>
              <div className="admin-dialog-actions">
                <button className="secondary-button" type="button" onClick={closeSuspensionDialog}>
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
