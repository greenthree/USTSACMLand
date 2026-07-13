import Ban from 'lucide-react/dist/esm/icons/ban'
import Check from 'lucide-react/dist/esm/icons/check'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Search from 'lucide-react/dist/esm/icons/search'
import X from 'lucide-react/dist/esm/icons/x'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { mockReviewMembers } from '../../data/mock'
import { triggerAdminImmediateSync } from '../../lib/adminImmediateSync'
import { fetchAdminReviewMembers, setAdminMemberReviewStatus } from '../../lib/adminMembers'
import { supabase } from '../../lib/supabase'
import type { ReviewMember, ReviewStatus } from '../../types/domain'

export function AdminMembersPage() {
  const demo = !supabase
  const [members, setMembers] = useState<ReviewMember[]>(() => (demo ? mockReviewMembers : []))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ReviewStatus | 'all'>('all')
  const [loading, setLoading] = useState(!demo)
  const [busyMemberIds, setBusyMemberIds] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [rejectionMember, setRejectionMember] = useState<ReviewMember | null>(null)
  const [rejectionNote, setRejectionNote] = useState('')
  const [suspensionMember, setSuspensionMember] = useState<ReviewMember | null>(null)

  const loadMembers = useCallback(async () => {
    if (demo) return

    setLoading(true)
    setNotice('')
    try {
      setMembers(await fetchAdminReviewMembers())
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '成员列表读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const filteredMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          (status === 'all' || member.reviewStatus === status) &&
          (query.length === 0 || member.name.includes(query) || member.email.includes(query)),
      ),
    [members, query, status],
  )

  async function updateStatus(
    member: ReviewMember,
    reviewStatus: ReviewStatus,
    reviewNote: string | null = null,
  ) {
    setBusyMemberIds((current) => new Set(current).add(member.id))
    setNotice('')

    try {
      const updatedAt = await setAdminMemberReviewStatus(
        member.id,
        reviewStatus,
        member.updatedAt,
        reviewNote,
      )
      setMembers((current) =>
        current.map((item) =>
          item.id === member.id ? { ...item, reviewStatus, reviewNote, updatedAt } : item,
        ),
      )
      const successNotice = `${member.name} 已更新为“${reviewStatusLabel(reviewStatus)}”。`
      setNoticeKind('success')
      setNotice(successNotice)

      if (reviewStatus === 'approved') {
        try {
          await triggerAdminImmediateSync({
            memberId: member.id,
            triggerType: 'registration',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知同步错误'
          setNoticeKind('error')
          setNotice(`${successNotice} 首次同步失败：${message}。`)
        }
      }
    } catch (error) {
      await loadMembers()
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '审核操作失败。')
    } finally {
      setBusyMemberIds((current) => {
        const next = new Set(current)
        next.delete(member.id)
        return next
      })
    }
  }

  function openRejectionDialog(member: ReviewMember) {
    setRejectionMember(member)
    setRejectionNote(member.reviewNote ?? '')
  }

  function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rejectionMember) return

    const member = rejectionMember
    const note = rejectionNote.trim() || null
    setRejectionMember(null)
    setRejectionNote('')
    void updateStatus(member, 'rejected', note)
  }

  function submitSuspension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!suspensionMember) return

    const member = suspensionMember
    setSuspensionMember(null)
    void updateStatus(member, 'suspended')
  }

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <h1>成员审核</h1>
          <p>审核成员身份与资料，处理批准、驳回和停用状态。</p>
        </div>
        <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
      </section>

      <div className="admin-toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索姓名或邮箱</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或邮箱"
          />
        </label>
        <label className="select-field plain-select">
          <span className="sr-only">审核状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ReviewStatus | 'all')}
          >
            <option value="all">全部状态</option>
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
            <option value="suspended">已停用</option>
          </select>
        </label>
      </div>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取成员审核列表" /> : null}

      {!loading && filteredMembers.length === 0 ? (
        <EmptyState title="没有匹配的成员" description="调整搜索词或审核状态后重试。" />
      ) : null}

      {!loading && filteredMembers.length > 0 ? (
        <div className="compact-table-wrap admin-table-wrap">
          <table className="compact-table admin-members-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>年级</th>
                <th>专业</th>
                <th>QQ</th>
                <th>平台数</th>
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
                      {member.reviewNote ? <small>备注：{member.reviewNote}</small> : null}
                    </td>
                    <td data-label="年级">{member.grade}</td>
                    <td data-label="专业">{member.major}</td>
                    <td data-label="QQ">{member.qq}</td>
                    <td data-label="平台数">{member.platformCount}</td>
                    <td data-label="状态">
                      <StatusBadge status={member.reviewStatus} />
                    </td>
                    <td data-label="操作">
                      <div className="row-actions">
                        {member.reviewStatus === 'pending' || member.reviewStatus === 'rejected' ? (
                          <button
                            className="icon-button approve-button"
                            type="button"
                            title="批准"
                            aria-label={`批准 ${member.name}`}
                            disabled={busy}
                            onClick={() => void updateStatus(member, 'approved')}
                          >
                            <Check size={16} />
                          </button>
                        ) : null}
                        {member.reviewStatus === 'pending' ? (
                          <button
                            className="icon-button reject-button"
                            type="button"
                            title="驳回"
                            aria-label={`驳回 ${member.name}`}
                            disabled={busy}
                            onClick={() => openRejectionDialog(member)}
                          >
                            <X size={16} />
                          </button>
                        ) : null}
                        {member.reviewStatus === 'pending' || member.reviewStatus === 'approved' ? (
                          <button
                            className="icon-button suspend-button"
                            type="button"
                            title="停用"
                            aria-label={`停用 ${member.name}`}
                            disabled={busy}
                            onClick={() => setSuspensionMember(member)}
                          >
                            <Ban size={16} />
                          </button>
                        ) : null}
                        {member.reviewStatus === 'rejected' ||
                        member.reviewStatus === 'suspended' ? (
                          <button
                            className="icon-button"
                            type="button"
                            title="恢复为待审核"
                            aria-label={`恢复 ${member.name} 为待审核`}
                            disabled={busy}
                            onClick={() => void updateStatus(member, 'pending')}
                          >
                            <RotateCcw size={16} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {rejectionMember ? (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setRejectionMember(null)
          }}
        >
          <section
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rejection-dialog-title"
          >
            <form onSubmit={submitRejection}>
              <div className="admin-dialog-header">
                <h2 id="rejection-dialog-title">驳回 {rejectionMember.name}</h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭驳回对话框"
                  onClick={() => setRejectionMember(null)}
                >
                  <X size={17} />
                </button>
              </div>
              <label className="admin-dialog-field">
                <span>驳回原因（可选）</span>
                <textarea
                  autoFocus
                  maxLength={1000}
                  rows={4}
                  value={rejectionNote}
                  onChange={(event) => setRejectionNote(event.target.value)}
                />
              </label>
              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setRejectionMember(null)}
                >
                  取消
                </button>
                <button className="primary-button reject-confirm-button" type="submit">
                  <X size={16} aria-hidden="true" />
                  确认驳回
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {suspensionMember ? (
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSuspensionMember(null)
          }}
        >
          <section
            className="admin-dialog admin-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspension-dialog-title"
          >
            <form onSubmit={submitSuspension}>
              <div className="admin-dialog-header">
                <h2 id="suspension-dialog-title">停用 {suspensionMember.name}</h2>
              </div>
              <p>停用后该成员将无法修改资料或发起同步。</p>
              <div className="admin-dialog-actions">
                <button
                  autoFocus
                  className="secondary-button"
                  type="button"
                  onClick={() => setSuspensionMember(null)}
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

function reviewStatusLabel(status: ReviewStatus) {
  const labels: Record<ReviewStatus, string> = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已驳回',
    suspended: '已停用',
  }
  return labels[status]
}
