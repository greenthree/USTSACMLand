import Archive from 'lucide-react/dist/esm/icons/archive'
import Megaphone from 'lucide-react/dist/esm/icons/megaphone'
import Pencil from 'lucide-react/dist/esm/icons/pencil'
import Plus from 'lucide-react/dist/esm/icons/plus'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import X from 'lucide-react/dist/esm/icons/x'
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import {
  deleteAdminAnnouncement,
  fetchAdminAnnouncements,
  saveAdminAnnouncement,
} from '../../lib/adminAnnouncements'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type {
  AdminAnnouncement,
  AdminAnnouncementInput,
  AnnouncementStatus,
} from '../../types/domain'

const statusLabels: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

const announcementPageSize = 50

const demoAnnouncements: AdminAnnouncement[] = [
  {
    id: 1,
    title: '暑期集训安排',
    body: '暑期集训将按基础、进阶两个阶段进行，具体题单与场次安排请关注后续通知。',
    status: 'published',
    publishedAt: '2026-07-12T08:00:00+08:00',
    expiresAt: null,
    createdBy: null,
    createdByLabel: '演示管理员',
    updatedBy: null,
    updatedByLabel: '演示管理员',
    createdAt: '2026-07-11T20:00:00+08:00',
    updatedAt: '2026-07-12T08:00:00+08:00',
  },
  {
    id: 2,
    title: '新生训练资料整理中',
    body: '新生学习引导与基础题单正在整理，本公告仍为草稿。',
    status: 'draft',
    publishedAt: null,
    expiresAt: null,
    createdBy: null,
    createdByLabel: '演示管理员',
    updatedBy: null,
    updatedByLabel: '演示管理员',
    createdAt: '2026-07-14T18:00:00+08:00',
    updatedAt: '2026-07-14T18:00:00+08:00',
  },
]

interface AnnouncementFormValues {
  title: string
  body: string
  status: AnnouncementStatus
  publishedAt: string
  expiresAt: string
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function statusLabel(announcement: AdminAnnouncement): string {
  if (
    announcement.status === 'published' &&
    announcement.publishedAt &&
    Date.parse(announcement.publishedAt) > Date.now()
  ) {
    return '待发布'
  }
  if (
    announcement.status === 'published' &&
    announcement.expiresAt &&
    Date.parse(announcement.expiresAt) <= Date.now()
  ) {
    return '已过期'
  }
  return statusLabels[announcement.status]
}

function initialValues(announcement: AdminAnnouncement | null): AnnouncementFormValues {
  return {
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    status: announcement?.status ?? 'draft',
    publishedAt: toDateTimeLocal(announcement?.publishedAt ?? null),
    expiresAt: toDateTimeLocal(announcement?.expiresAt ?? null),
  }
}

function trapDialogFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  dialogRef: RefObject<HTMLElement | null>,
) {
  if (event.key !== 'Tab') return

  const focusableElements = Array.from(
    dialogRef.current?.querySelectorAll<HTMLElement>(
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

export function AdminAnnouncementsPage() {
  const demo = !supabase
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>(() =>
    demo ? demoAnnouncements : [],
  )
  const [filter, setFilter] = useState<AnnouncementStatus | 'all'>('all')
  const [loading, setLoading] = useState(!demo)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [editing, setEditing] = useState<AdminAnnouncement | null | undefined>(undefined)
  const [formValues, setFormValues] = useState<AnnouncementFormValues>(() => initialValues(null))
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<AdminAnnouncement | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const editorDialogRef = useRef<HTMLElement>(null)
  const editorTriggerRef = useRef<HTMLElement | null>(null)
  const deleteDialogRef = useRef<HTMLElement>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)

  const loadAnnouncements = useCallback(async () => {
    if (demo) return demoAnnouncements

    setLoading(true)
    setNotice('')
    try {
      const rows = await fetchAdminAnnouncements(announcementPageSize + 1)
      const firstPage = rows.slice(0, announcementPageSize)
      setAnnouncements(firstPage)
      setHasMore(rows.length > announcementPageSize)
      return firstPage
    } catch (error) {
      setAnnouncements([])
      setHasMore(false)
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '公告列表读取失败。')
      return []
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadAnnouncements()
  }, [loadAnnouncements])

  const filteredAnnouncements = useMemo(
    () =>
      filter === 'all'
        ? announcements
        : announcements.filter((announcement) => announcement.status === filter),
    [announcements, filter],
  )

  async function loadMoreAnnouncements() {
    const cursor = announcements.at(-1)?.id
    if (demo || !hasMore || cursor === undefined) return

    setLoadingMore(true)
    setNotice('')
    try {
      const rows = await fetchAdminAnnouncements(announcementPageSize + 1, cursor)
      const nextPage = rows.slice(0, announcementPageSize)
      setAnnouncements((current) => [...current, ...nextPage])
      setHasMore(rows.length > announcementPageSize)
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '更多公告读取失败。')
    } finally {
      setLoadingMore(false)
    }
  }

  function openEditor(announcement: AdminAnnouncement | null) {
    const activeElement = document.activeElement
    editorTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null
    setEditing(announcement)
    setFormValues(initialValues(announcement))
    setFormError('')
  }

  function finishEditing() {
    setEditing(undefined)
    setFormError('')
    const trigger = editorTriggerRef.current
    editorTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }

  function closeEditor() {
    if (saving) return
    finishEditing()
  }

  function openDeleteDialog(announcement: AdminAnnouncement) {
    const activeElement = document.activeElement
    deleteTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null
    setDeleting(announcement)
  }

  function closeDeleteDialog() {
    if (deletingBusy) return
    setDeleting(null)
    const trigger = deleteTriggerRef.current
    deleteTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }

  function updateStatus(status: AnnouncementStatus) {
    setFormValues((current) => ({
      ...current,
      status,
      publishedAt:
        status === 'draft'
          ? ''
          : status === 'published'
            ? current.publishedAt || toDateTimeLocal(new Date().toISOString())
            : current.publishedAt,
      expiresAt: status === 'draft' ? '' : current.expiresAt,
    }))
  }

  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = formValues.title.trim()
    const body = formValues.body.trim()
    if (title.length < 1 || title.length > 120) {
      setFormError('标题需包含 1 到 120 个字符。')
      return
    }
    if (body.length < 1 || body.length > 20_000) {
      setFormError('正文需包含 1 到 20000 个字符。')
      return
    }

    const publishedAt =
      formValues.status === 'draft' ? null : fromDateTimeLocal(formValues.publishedAt)
    const expiresAt = formValues.status === 'draft' ? null : fromDateTimeLocal(formValues.expiresAt)
    if (expiresAt && (!publishedAt || Date.parse(expiresAt) <= Date.parse(publishedAt))) {
      setFormError('过期时间必须晚于发布时间。')
      return
    }

    const input: AdminAnnouncementInput = {
      id: editing?.id ?? null,
      title,
      body,
      status: formValues.status,
      publishedAt,
      expiresAt,
      expectedUpdatedAt: editing?.updatedAt ?? null,
    }
    setSaving(true)
    setFormError('')
    try {
      const saved = await saveAdminAnnouncement(input)
      if (demo) {
        const now = saved.updatedAt
        setAnnouncements((current) => {
          const next: AdminAnnouncement = {
            id: saved.id,
            title,
            body,
            status: formValues.status,
            publishedAt,
            expiresAt,
            createdBy: editing?.createdBy ?? null,
            createdByLabel: editing?.createdByLabel ?? '演示管理员',
            updatedBy: null,
            updatedByLabel: '演示管理员',
            createdAt: editing?.createdAt ?? now,
            updatedAt: now,
          }
          return editing
            ? current.map((announcement) => (announcement.id === editing.id ? next : announcement))
            : [next, ...current]
        })
      } else {
        await loadAnnouncements()
      }
      setNoticeKind('success')
      setNotice(editing ? '公告已更新。' : '公告已创建。')
      finishEditing()
    } catch (error) {
      const message = error instanceof Error ? error.message : '公告保存失败。'
      setFormError(message)
      if (!demo && editing) {
        const refreshed = await loadAnnouncements()
        const currentVersion = refreshed.find((announcement) => announcement.id === editing.id)
        if (currentVersion) setEditing(currentVersion)
      }
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deleting) return

    setDeletingBusy(true)
    setNotice('')
    try {
      await deleteAdminAnnouncement(deleting.id, deleting.updatedAt)
      setAnnouncements((current) => current.filter((item) => item.id !== deleting.id))
      setNoticeKind('success')
      setNotice('公告已删除。')
      setDeleting(null)
      deleteTriggerRef.current = null
    } catch (error) {
      const message = error instanceof Error ? error.message : '公告删除失败。'
      setNoticeKind('error')
      setNotice(message)
      if (!demo) {
        const refreshed = await loadAnnouncements()
        const currentVersion = refreshed.find((announcement) => announcement.id === deleting.id)
        setDeleting(currentVersion ?? null)
        setNoticeKind('error')
        setNotice(message)
      }
    } finally {
      setDeletingBusy(false)
    }
  }

  return (
    <div className="admin-page" aria-busy={loading || loadingMore || saving || deletingBusy}>
      <section className="admin-page-heading">
        <div>
          <h1>公告管理</h1>
          <p>维护官网公开公告、发布时间与过期时间。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
          <button className="primary-button" type="button" onClick={() => openEditor(null)}>
            <Plus size={16} aria-hidden="true" />
            新建公告
          </button>
        </div>
      </section>

      <div className="admin-toolbar announcement-toolbar">
        <p>公开页面只展示已到发布时间且尚未过期的“已发布”公告。</p>
        <label className="select-field plain-select">
          <span className="sr-only">公告状态</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as AnnouncementStatus | 'all')}
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      </div>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取公告列表" /> : null}

      {!loading && filteredAnnouncements.length === 0 ? (
        <EmptyState title="暂无匹配公告" description="新建公告或调整状态筛选后重试。" />
      ) : null}

      {!loading && filteredAnnouncements.length > 0 ? (
        <>
          <div className="compact-table-wrap admin-table-wrap">
            <table className="compact-table admin-members-table announcement-table">
              <thead>
                <tr>
                  <th>公告</th>
                  <th>状态</th>
                  <th>发布时间</th>
                  <th>过期时间</th>
                  <th>最后编辑</th>
                  <th className="actions-column">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAnnouncements.map((announcement) => (
                  <tr key={announcement.id}>
                    <td data-label="公告">
                      <strong>{announcement.title}</strong>
                      <small>{announcement.body}</small>
                    </td>
                    <td data-label="状态">
                      <span
                        className={`announcement-status announcement-status-${announcement.status}`}
                      >
                        {statusLabel(announcement)}
                      </span>
                    </td>
                    <td data-label="发布时间">{formatDateTime(announcement.publishedAt)}</td>
                    <td data-label="过期时间">
                      {announcement.expiresAt ? formatDateTime(announcement.expiresAt) : '长期有效'}
                    </td>
                    <td data-label="最后编辑">
                      <span className="announcement-editor">
                        <strong>{announcement.updatedByLabel}</strong>
                        <small>{formatDateTime(announcement.updatedAt)}</small>
                      </span>
                    </td>
                    <td data-label="操作">
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          title="编辑公告"
                          aria-label={`编辑公告 ${announcement.title}`}
                          onClick={() => openEditor(announcement)}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button reject-button"
                          type="button"
                          title="删除公告"
                          aria-label={`删除公告 ${announcement.title}`}
                          onClick={() => openDeleteDialog(announcement)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore ? (
            <div className="admin-pagination">
              <button
                className="secondary-button"
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMoreAnnouncements()}
              >
                {loadingMore ? '正在加载' : '加载更多公告'}
              </button>
              <small>状态筛选作用于已加载的 {announcements.length} 条公告。</small>
            </div>
          ) : null}
        </>
      ) : null}

      {editing !== undefined ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog announcement-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-dialog-title"
            ref={editorDialogRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeEditor()
                return
              }
              trapDialogFocus(event, editorDialogRef)
            }}
          >
            <form onSubmit={(event) => void submitAnnouncement(event)}>
              <div className="admin-dialog-header">
                <div>
                  <h2 id="announcement-dialog-title">{editing ? '编辑公告' : '新建公告'}</h2>
                  <p>正文按纯文本保存，发布后可被未登录访客读取。</p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭公告编辑对话框"
                  disabled={saving}
                  onClick={closeEditor}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>

              <label className="admin-dialog-field">
                标题
                <input
                  autoFocus
                  maxLength={120}
                  required
                  value={formValues.title}
                  aria-describedby={formError ? 'announcement-form-error' : undefined}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, title: event.target.value }))
                  }
                />
                <small>{formValues.title.length}/120</small>
              </label>

              <label className="admin-dialog-field">
                正文
                <textarea
                  rows={9}
                  maxLength={20_000}
                  required
                  value={formValues.body}
                  aria-describedby={formError ? 'announcement-form-error' : undefined}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, body: event.target.value }))
                  }
                />
                <small>{formValues.body.length}/20000</small>
              </label>

              <div className="announcement-schedule-grid">
                <label className="admin-dialog-field">
                  状态
                  <select
                    value={formValues.status}
                    onChange={(event) => updateStatus(event.target.value as AnnouncementStatus)}
                  >
                    <option value="draft">草稿</option>
                    <option value="published">发布</option>
                    <option value="archived">归档</option>
                  </select>
                </label>
                <label className="admin-dialog-field">
                  发布时间
                  <input
                    type="datetime-local"
                    value={formValues.publishedAt}
                    disabled={formValues.status === 'draft'}
                    onChange={(event) =>
                      setFormValues((current) => ({
                        ...current,
                        publishedAt: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="admin-dialog-field">
                  过期时间（可选）
                  <input
                    type="datetime-local"
                    value={formValues.expiresAt}
                    disabled={formValues.status === 'draft'}
                    onChange={(event) =>
                      setFormValues((current) => ({ ...current, expiresAt: event.target.value }))
                    }
                  />
                </label>
              </div>

              {formError ? (
                <p className="form-error" id="announcement-form-error" role="alert">
                  {formError}
                </p>
              ) : null}

              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={closeEditor}
                >
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {formValues.status === 'archived' ? (
                    <Archive size={16} aria-hidden="true" />
                  ) : (
                    <Megaphone size={16} aria-hidden="true" />
                  )}
                  {saving ? '正在保存' : '保存公告'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deleting ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog admin-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-announcement-title"
            ref={deleteDialogRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeDeleteDialog()
                return
              }
              trapDialogFocus(event, deleteDialogRef)
            }}
          >
            <form onSubmit={(event) => void confirmDelete(event)}>
              <div className="admin-dialog-header">
                <h2 id="delete-announcement-title">删除公告</h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭删除公告对话框"
                  disabled={deletingBusy}
                  onClick={closeDeleteDialog}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              <p>将永久删除“{deleting.title}”。该操作会写入审计日志，无法撤销。</p>
              <div className="admin-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  autoFocus
                  disabled={deletingBusy}
                  onClick={closeDeleteDialog}
                >
                  取消
                </button>
                <button className="danger-button" type="submit" disabled={deletingBusy}>
                  <Trash2 size={16} aria-hidden="true" />
                  {deletingBusy ? '正在删除' : '确认删除'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
