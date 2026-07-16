import Ban from 'lucide-react/dist/esm/icons/ban'
import Download from 'lucide-react/dist/esm/icons/download'
import Eye from 'lucide-react/dist/esm/icons/eye'
import Pencil from 'lucide-react/dist/esm/icons/pencil'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Save from 'lucide-react/dist/esm/icons/save'
import Search from 'lucide-react/dist/esm/icons/search'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import UserRound from 'lucide-react/dist/esm/icons/user-round'
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
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { mockAdminMembers } from '../../data/mock'
import {
  buildAdminMembersCsv,
  fetchAdminMembers,
  setAdminMemberRole,
  setAdminMemberSuspension,
  updateAdminMemberProfile,
} from '../../lib/adminMembers'
import { formatDateTime } from '../../lib/format'
import { gradeOptions, majorSuggestions } from '../../lib/profileFields'
import { supabase } from '../../lib/supabase'
import type {
  AdminMember,
  AdminMemberProfileUpdate,
  AdminMemberRole,
  AdminMemberStatus,
} from '../../types/domain'

const memberStatusLabels: Record<AdminMemberStatus, string> = {
  active: '正常',
  suspended: '已停用',
}

const memberRoleLabels: Record<AdminMemberRole, string> = {
  member: '成员',
  admin: '管理员',
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
  const [editingMember, setEditingMember] = useState<AdminMember | null>(null)
  const [editValues, setEditValues] = useState<AdminMemberProfileUpdate | null>(null)
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [roleMember, setRoleMember] = useState<AdminMember | null>(null)
  const [roleReason, setRoleReason] = useState('')
  const [roleConfirmed, setRoleConfirmed] = useState(false)
  const [savingRole, setSavingRole] = useState(false)
  const suspensionDialogRef = useRef<HTMLElement | null>(null)
  const suspensionTriggerRef = useRef<HTMLElement | null>(null)
  const editDialogRef = useRef<HTMLElement | null>(null)
  const editTriggerRef = useRef<HTMLElement | null>(null)
  const roleDialogRef = useRef<HTMLElement | null>(null)
  const roleTriggerRef = useRef<HTMLElement | null>(null)

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

  function openRoleDialog(member: AdminMember, trigger: HTMLElement) {
    roleTriggerRef.current = trigger
    setRoleMember(member)
    setRoleReason('')
    setRoleConfirmed(false)
  }

  function closeRoleDialog() {
    if (savingRole) return
    setRoleMember(null)
    setRoleReason('')
    setRoleConfirmed(false)
    const trigger = roleTriggerRef.current
    roleTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }

  function handleRoleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !savingRole) {
      event.preventDefault()
      closeRoleDialog()
      return
    }
    if (event.key !== 'Tab') return

    const focusableElements = Array.from(
      roleDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  async function submitRoleChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!roleMember || !roleConfirmed || roleReason.trim().length < 3) return

    const member = roleMember
    const nextRole: AdminMemberRole = member.role === 'admin' ? 'member' : 'admin'
    setSavingRole(true)
    setBusyMemberIds((current) => new Set(current).add(member.id))
    setNotice('')
    try {
      const updatedAt = await setAdminMemberRole(
        member.id,
        nextRole,
        member.updatedAt,
        roleReason.trim(),
      )
      setMembers((current) =>
        current.map((item) =>
          item.id === member.id ? { ...item, role: nextRole, updatedAt } : item,
        ),
      )
      setNoticeKind('success')
      setNotice(
        nextRole === 'admin' ? `${member.name} 已设为管理员。` : `${member.name} 已降为普通成员。`,
      )
      setRoleMember(null)
      setRoleReason('')
      setRoleConfirmed(false)
      const trigger = roleTriggerRef.current
      roleTriggerRef.current = null
      window.setTimeout(() => {
        if (trigger && document.contains(trigger)) trigger.focus()
      }, 0)
    } catch (error) {
      if (!demo) await loadMembers()
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '成员角色更新失败。')
    } finally {
      setSavingRole(false)
      setBusyMemberIds((current) => {
        const next = new Set(current)
        next.delete(member.id)
        return next
      })
    }
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

  function openEditDialog(member: AdminMember) {
    const activeElement = document.activeElement
    editTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null
    setEditingMember(member)
    setEditValues({
      name: member.name,
      qq: member.qq,
      grade: member.grade,
      major: member.major,
      isPublic: member.isPublic,
    })
    setEditError('')
  }

  function closeEditDialog() {
    setEditingMember(null)
    setEditValues(null)
    setEditError('')
    const trigger = editTriggerRef.current
    editTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }

  function handleEditDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !savingEdit) {
      event.preventDefault()
      closeEditDialog()
      return
    }

    if (event.key !== 'Tab') return

    const focusableElements = Array.from(
      editDialogRef.current?.querySelectorAll<HTMLElement>(
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

  async function submitMemberEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingMember || !editValues) return

    const normalizedValues: AdminMemberProfileUpdate = {
      name: editValues.name.trim(),
      qq: editValues.qq.trim(),
      grade: editValues.grade.trim(),
      major: editValues.major.trim(),
      isPublic: editValues.isPublic,
    }

    setSavingEdit(true)
    setEditError('')
    try {
      const updatedAt = await updateAdminMemberProfile(
        editingMember.id,
        normalizedValues,
        editingMember.updatedAt,
      )
      setMembers((current) =>
        current.map((member) =>
          member.id === editingMember.id ? { ...member, ...normalizedValues, updatedAt } : member,
        ),
      )
      setNoticeKind('success')
      setNotice(`${normalizedValues.name} 的资料已更新。`)
      closeEditDialog()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '成员资料更新失败。')
    } finally {
      setSavingEdit(false)
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

  function exportMembersCsv() {
    if (filteredMembers.length === 0) return

    const url = URL.createObjectURL(
      new Blob([buildAdminMembersCsv(filteredMembers)], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'usts-acm-land-members.csv'
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <h1>成员管理</h1>
          <p>查看成员资料与平台绑定，并管理公开参榜和数据同步资格。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
          <button
            className="secondary-button"
            type="button"
            onClick={exportMembersCsv}
            disabled={loading || filteredMembers.length === 0}
          >
            <Download size={16} aria-hidden="true" />
            导出当前列表
          </button>
        </div>
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
                <th>角色</th>
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
                    <td data-label="角色">
                      <span
                        className={`status ${member.role === 'admin' ? 'status-verified' : 'status-missing'}`}
                      >
                        {memberRoleLabels[member.role]}
                      </span>
                    </td>
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
                        {member.role === 'member' ? (
                          <Link
                            className="icon-button"
                            to={`/admin/members/${member.id}`}
                            title="查看成员详情"
                            aria-label={`查看 ${member.name} 详情`}
                          >
                            <Eye size={16} aria-hidden="true" />
                          </Link>
                        ) : null}
                        <button
                          className="icon-button"
                          type="button"
                          title="编辑成员"
                          aria-label={`编辑 ${member.name}`}
                          disabled={busy || member.role === 'admin'}
                          onClick={() => openEditDialog(member)}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        {member.role === 'member' && member.status === 'active' ? (
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
                        ) : member.role === 'member' ? (
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
                        ) : null}
                        <button
                          className="icon-button"
                          type="button"
                          title={member.role === 'admin' ? '降为普通成员' : '设为管理员'}
                          aria-label={`${member.role === 'admin' ? '降级' : '提升'} ${member.name}`}
                          disabled={busy || member.status !== 'active'}
                          onClick={(event) => openRoleDialog(member, event.currentTarget)}
                        >
                          {member.role === 'admin' ? (
                            <UserRound size={16} aria-hidden="true" />
                          ) : (
                            <ShieldCheck size={16} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {roleMember ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-member-dialog-title"
            ref={roleDialogRef}
            onKeyDown={handleRoleDialogKeyDown}
          >
            <form onSubmit={submitRoleChange}>
              <div className="admin-dialog-header">
                <h2 id="role-member-dialog-title">
                  {roleMember.role === 'admin' ? '移除管理员权限' : '授予管理员权限'}
                </h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭成员角色对话框"
                  disabled={savingRole}
                  onClick={closeRoleDialog}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              <p>
                {roleMember.role === 'admin'
                  ? `确认将 ${roleMember.name} 降为普通成员。系统会拒绝移除最后一名启用管理员。`
                  : `确认将 ${roleMember.name} 设为管理员。管理员可查看私有资料并执行高风险后台操作。`}
              </p>
              <label className="admin-dialog-field">
                <span>变更原因</span>
                <textarea
                  autoFocus
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  value={roleReason}
                  onChange={(event) => setRoleReason(event.target.value)}
                />
              </label>
              <label className="admin-member-public-field">
                <input
                  type="checkbox"
                  checked={roleConfirmed}
                  onChange={(event) => setRoleConfirmed(event.target.checked)}
                />
                <span>
                  <strong>我已核对目标账号与权限影响</strong>
                  <small>角色变更会记录操作者、目标、前后角色和原因。</small>
                </span>
              </label>
              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={savingRole}
                  onClick={closeRoleDialog}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={savingRole || !roleConfirmed || roleReason.trim().length < 3}
                >
                  {roleMember.role === 'admin' ? (
                    <UserRound size={16} aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={16} aria-hidden="true" />
                  )}
                  {savingRole ? '处理中' : roleMember.role === 'admin' ? '确认降级' : '确认授权'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editingMember && editValues ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog admin-member-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-member-dialog-title"
            ref={editDialogRef}
            onKeyDown={handleEditDialogKeyDown}
          >
            <form onSubmit={submitMemberEdit}>
              <div className="admin-dialog-header">
                <h2 id="edit-member-dialog-title">编辑 {editingMember.name}</h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭编辑成员对话框"
                  disabled={savingEdit}
                  onClick={closeEditDialog}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>

              <div className="admin-member-edit-grid">
                <label className="admin-dialog-field">
                  <span>姓名</span>
                  <input
                    autoFocus
                    required
                    maxLength={64}
                    value={editValues.name}
                    onChange={(event) =>
                      setEditValues((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label className="admin-dialog-field">
                  <span>QQ 号</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[1-9][0-9]{4,11}"
                    value={editValues.qq}
                    onChange={(event) =>
                      setEditValues((current) =>
                        current ? { ...current, qq: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label className="admin-dialog-field">
                  <span>年级</span>
                  <select
                    required
                    value={editValues.grade}
                    onChange={(event) =>
                      setEditValues((current) =>
                        current ? { ...current, grade: event.target.value } : current,
                      )
                    }
                  >
                    {!gradeOptions.includes(editValues.grade) ? (
                      <option value={editValues.grade}>{editValues.grade}</option>
                    ) : null}
                    {gradeOptions.map((grade) => (
                      <option value={grade} key={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-dialog-field">
                  <span>专业</span>
                  <input
                    required
                    list="admin-major-suggestions"
                    maxLength={100}
                    value={editValues.major}
                    onChange={(event) =>
                      setEditValues((current) =>
                        current ? { ...current, major: event.target.value } : current,
                      )
                    }
                  />
                  <datalist id="admin-major-suggestions">
                    {majorSuggestions.map((major) => (
                      <option value={major} key={major} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="admin-member-public-field">
                <input
                  type="checkbox"
                  checked={editValues.isPublic}
                  onChange={(event) =>
                    setEditValues((current) =>
                      current ? { ...current, isPublic: event.target.checked } : current,
                    )
                  }
                />
                <span>
                  <strong>允许公开展示</strong>
                  <small>资料完整且账号正常时，该成员会进入公开成员列表和榜单。</small>
                </span>
              </label>

              {editError ? (
                <p className="form-error" role="status">
                  {editError}
                </p>
              ) : null}

              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={savingEdit}
                  onClick={closeEditDialog}
                >
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={savingEdit}>
                  <Save size={16} aria-hidden="true" />
                  {savingEdit ? '保存中' : '保存修改'}
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
