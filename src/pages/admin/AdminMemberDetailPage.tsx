import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2'
import Database from 'lucide-react/dist/esm/icons/database'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link'
import Pencil from 'lucide-react/dist/esm/icons/pencil'
import Plus from 'lucide-react/dist/esm/icons/plus'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Save from 'lucide-react/dist/esm/icons/save'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import X from 'lucide-react/dist/esm/icons/x'
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { PlatformMark } from '../../components/PlatformMark'
import { mockAdminMemberDetail } from '../../data/mock'
import {
  fetchAdminMemberDetail,
  setAdminManualPlatformStats,
  unbindAdminMemberPlatformAccount,
  upsertAdminMemberPlatformAccount,
} from '../../lib/adminMemberDetail'
import { triggerAdminImmediateSync } from '../../lib/adminImmediateSync'
import { formatDateTime, formatInteger } from '../../lib/format'
import { platformLabels, platformUrls } from '../../lib/platforms'
import { supabase } from '../../lib/supabase'
import type {
  AdminManualStatsInput,
  AdminMemberActivity,
  AdminMemberDetail,
  AdminMemberPlatformDetail,
  Platform,
} from '../../types/domain'

const ratingPlatforms = new Set<Platform>(['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo'])
const solvedPlatforms = new Set<Platform>(['codeforces', 'nowcoder', 'atcoder', 'luogu', 'qoj'])

const accountStatusLabels: Record<AdminMemberPlatformDetail['accountStatus'], string> = {
  missing: '未绑定',
  pending: '待验证',
  verified: '已验证',
  invalid: '无效',
  disabled: '已停用',
}

const statStatusLabels: Record<AdminMemberPlatformDetail['statStatus'], string> = {
  missing: '暂无数据',
  fresh: '正常',
  stale: '已过期',
  unavailable: '不可用',
}

type DialogState =
  | { kind: 'account'; item: AdminMemberPlatformDetail }
  | { kind: 'manual'; item: AdminMemberPlatformDetail }
  | { kind: 'unbind'; item: AdminMemberPlatformDetail }

function accountStatusClass(status: AdminMemberPlatformDetail['accountStatus']): string {
  if (status === 'verified') return 'status-verified'
  if (status === 'invalid') return 'status-invalid'
  if (status === 'disabled') return 'status-disabled'
  if (status === 'pending') return 'status-pending'
  return 'status-missing'
}

function statStatusClass(status: AdminMemberPlatformDetail['statStatus']): string {
  if (status === 'fresh') return 'status-fresh'
  if (status === 'stale') return 'status-stale'
  if (status === 'unavailable') return 'status-error'
  return 'status-missing'
}

function toDateTimeLocal(value: string | null = null): string {
  const date = value ? new Date(value) : new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function optionalInteger(value: string, label: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label}必须是非负整数。`)
  return parsed
}

function optionalRating(value: string, label: string, platform: Platform): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  const decimalPlaces = normalized.match(/\.(\d+)$/)?.[1].length ?? 0
  const supportsDecimals = platform === 'xcpc_elo'
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    (supportsDecimals ? decimalPlaces > 2 : !Number.isInteger(parsed))
  ) {
    throw new Error(
      supportsDecimals ? `${label}必须是非负数，且最多保留两位小数。` : `${label}必须是非负整数。`,
    )
  }
  return parsed
}

function activityTitle(activity: AdminMemberActivity): string {
  const platform = activity.platform ? platformLabels[activity.platform] : null
  if (activity.action === 'manual_stats_updated') return `手工录入${platform ?? '平台'}数据`
  if (activity.kind === 'sync') return `${platform ?? '平台'}同步`
  if (activity.targetTable === 'profiles') return '修改成员资料'
  if (activity.targetTable === 'platform_accounts') {
    if (activity.action === 'insert') return `绑定${platform ?? '平台'}账号`
    if (activity.action === 'delete') return `解绑${platform ?? '平台'}账号`
    return `更新${platform ?? '平台'}账号`
  }
  return '后台操作'
}

function activityDescription(activity: AdminMemberActivity): string {
  if (activity.detail) return activity.detail
  if (activity.kind === 'sync') {
    const status =
      activity.runStatus === 'succeeded'
        ? '成功'
        : activity.runStatus === 'failed'
          ? '失败'
          : activity.runStatus
    return `${status ?? '已执行'}${activity.sourceVersion ? ` · ${activity.sourceVersion}` : ''}`
  }
  return '操作已记录'
}

export function AdminMemberDetailPage() {
  const { memberId = '' } = useParams()
  const demo = !supabase
  const [member, setMember] = useState<AdminMemberDetail | null>(() =>
    demo && memberId === mockAdminMemberDetail.id ? mockAdminMemberDetail : null,
  )
  const [loading, setLoading] = useState(!demo)
  const [loaded, setLoaded] = useState(demo)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [savingDialog, setSavingDialog] = useState(false)
  const [externalId, setExternalId] = useState('')
  const [currentRating, setCurrentRating] = useState('')
  const [maxRating, setMaxRating] = useState('')
  const [solvedCount, setSolvedCount] = useState('')
  const [sourceObservedAt, setSourceObservedAt] = useState('')
  const [manualNote, setManualNote] = useState('')
  const dialogRef = useRef<HTMLElement | null>(null)
  const dialogTriggerRef = useRef<HTMLElement | null>(null)

  const loadMember = useCallback(
    async (clearNotice = true) => {
      if (demo) {
        setLoaded(true)
        return
      }
      setLoading(true)
      if (clearNotice) setNotice('')
      try {
        setMember(await fetchAdminMemberDetail(memberId))
      } catch (error) {
        setMember(null)
        setNoticeKind('error')
        setNotice(error instanceof Error ? error.message : '成员详情读取失败。')
      } finally {
        setLoading(false)
        setLoaded(true)
      }
    },
    [demo, memberId],
  )

  useEffect(() => {
    void loadMember()
  }, [loadMember])

  function rememberDialogTrigger() {
    const activeElement = document.activeElement
    dialogTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null
  }

  function openAccountDialog(item: AdminMemberPlatformDetail) {
    rememberDialogTrigger()
    setExternalId(item.externalId ?? '')
    setDialogError('')
    setDialog({ kind: 'account', item })
  }

  function openManualDialog(item: AdminMemberPlatformDetail) {
    rememberDialogTrigger()
    setCurrentRating(item.currentRating?.toString() ?? '')
    setMaxRating(item.maxRating?.toString() ?? '')
    setSolvedCount(item.solvedCount?.toString() ?? '')
    setSourceObservedAt(toDateTimeLocal(item.sourceObservedAt))
    setManualNote('')
    setDialogError('')
    setDialog({ kind: 'manual', item })
  }

  function openUnbindDialog(item: AdminMemberPlatformDetail) {
    rememberDialogTrigger()
    setDialogError('')
    setDialog({ kind: 'unbind', item })
  }

  function dismissDialog() {
    setDialog(null)
    setDialogError('')
    const trigger = dialogTriggerRef.current
    dialogTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }

  function closeDialog() {
    if (savingDialog) return
    dismissDialog()
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !savingDialog) {
      event.preventDefault()
      closeDialog()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function updateDemoPlatform(platform: Platform, update: Partial<AdminMemberPlatformDetail>) {
    setMember((current) =>
      current
        ? {
            ...current,
            platforms: current.platforms.map((item) =>
              item.platform === platform ? { ...item, ...update } : item,
            ),
          }
        : current,
    )
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog || dialog.kind !== 'account' || !member) return
    const normalizedExternalId = externalId.trim()
    if (!normalizedExternalId) {
      setDialogError('请输入平台账号。')
      return
    }

    setSavingDialog(true)
    setDialogError('')
    try {
      if (demo) {
        updateDemoPlatform(dialog.item.platform, {
          accountId: dialog.item.accountId ?? Date.now(),
          externalId: normalizedExternalId,
          accountStatus: 'pending',
          accountUpdatedAt: new Date().toISOString(),
          statStatus: dialog.item.accountId === null ? 'missing' : 'unavailable',
        })
      } else {
        await upsertAdminMemberPlatformAccount(
          member.id,
          dialog.item.platform,
          normalizedExternalId,
          dialog.item.accountUpdatedAt,
        )
        await loadMember(false)
      }
      setNoticeKind('success')
      setNotice(`${platformLabels[dialog.item.platform]} 账号已保存，等待验证。`)
      dismissDialog()
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '平台账号保存失败。')
    } finally {
      setSavingDialog(false)
    }
  }

  async function saveManualStats(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog || dialog.kind !== 'manual' || !member) return
    const platform = dialog.item.platform

    try {
      const nextCurrentRating = ratingPlatforms.has(platform)
        ? optionalRating(currentRating, '当前 Rating', platform)
        : null
      const nextMaxRating = ratingPlatforms.has(platform)
        ? optionalRating(maxRating, '历史最高 Rating', platform)
        : null
      const nextSolvedCount = solvedPlatforms.has(platform)
        ? optionalInteger(solvedCount, '通过题数')
        : null
      if ((nextCurrentRating === null) !== (nextMaxRating === null)) {
        throw new Error('当前 Rating 和历史最高 Rating 必须同时填写或同时留空。')
      }
      if (
        nextCurrentRating !== null &&
        nextMaxRating !== null &&
        nextMaxRating < nextCurrentRating
      ) {
        throw new Error('历史最高 Rating 不能低于当前 Rating。')
      }
      if (nextCurrentRating === null && nextSolvedCount === null) {
        throw new Error('请至少填写一项平台数据。')
      }
      const normalizedNote = manualNote.trim()
      if (!normalizedNote) throw new Error('请填写手工录入原因。')

      const values: AdminManualStatsInput = {
        currentRating: nextCurrentRating,
        maxRating: nextMaxRating,
        solvedCount: nextSolvedCount,
        sourceObservedAt: sourceObservedAt ? new Date(sourceObservedAt).toISOString() : null,
        note: normalizedNote,
      }

      setSavingDialog(true)
      setDialogError('')
      if (demo) {
        const now = new Date().toISOString()
        updateDemoPlatform(platform, {
          currentRating: values.currentRating,
          maxRating: values.maxRating,
          solvedCount: values.solvedCount,
          statStatus: 'fresh',
          sourceObservedAt: values.sourceObservedAt,
          lastSuccessAt: now,
          sourceVersion: 'admin-manual/v1',
          statUpdatedAt: now,
        })
      } else {
        await setAdminManualPlatformStats(member.id, platform, values, dialog.item.statUpdatedAt)
        await loadMember(false)
      }
      setNoticeKind('success')
      setNotice(`${platformLabels[platform]} 手工数据已保存。`)
      dismissDialog()
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '手工数据保存失败。')
    } finally {
      setSavingDialog(false)
    }
  }

  async function confirmUnbind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog || dialog.kind !== 'unbind' || !member || !dialog.item.accountUpdatedAt) return
    const platform = dialog.item.platform

    setSavingDialog(true)
    setDialogError('')
    try {
      if (demo) {
        updateDemoPlatform(platform, {
          accountId: null,
          externalId: null,
          accountStatus: 'missing',
          verifiedAt: null,
          accountUpdatedAt: null,
          currentRating: null,
          maxRating: null,
          solvedCount: null,
          statStatus: 'missing',
          sourceObservedAt: null,
          lastSuccessAt: null,
          staleAfter: null,
          sourceVersion: null,
          statUpdatedAt: null,
        })
      } else {
        await unbindAdminMemberPlatformAccount(member.id, platform, dialog.item.accountUpdatedAt)
        await loadMember(false)
      }
      setNoticeKind('success')
      setNotice(`${platformLabels[platform]} 账号已解绑。`)
      dismissDialog()
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '平台账号解绑失败。')
    } finally {
      setSavingDialog(false)
    }
  }

  async function verifyAccount(item: AdminMemberPlatformDetail) {
    if (!member || item.accountId === null || !item.accountUpdatedAt) return
    setBusyPlatform(item.platform)
    setNotice('')
    let verificationFailure = ''
    let refreshFailure = ''
    try {
      if (demo) {
        updateDemoPlatform(item.platform, {
          accountStatus: 'verified',
          verifiedAt: new Date().toISOString(),
          accountUpdatedAt: new Date().toISOString(),
        })
      } else {
        try {
          await triggerAdminImmediateSync({
            memberId: member.id,
            platforms: [item.platform],
            triggerType: 'account_changed',
          })
        } catch (error) {
          verificationFailure = error instanceof Error ? error.message : '未知验证错误'
        }

        try {
          await loadMember(false)
        } catch (error) {
          refreshFailure = error instanceof Error ? error.message : '未知刷新错误'
        }
      }

      if (verificationFailure) {
        setNoticeKind('error')
        setNotice(
          `${platformLabels[item.platform]} 账号验证未通过：${verificationFailure}${refreshFailure ? `。成员数据刷新失败：${refreshFailure}` : ''}`,
        )
      } else if (refreshFailure) {
        setNoticeKind('error')
        setNotice(
          `${platformLabels[item.platform]} 账号已验证并完成首次同步，但成员数据刷新失败：${refreshFailure}`,
        )
      } else {
        setNoticeKind('success')
        setNotice(`${platformLabels[item.platform]} 账号已验证并完成首次同步。`)
      }
    } finally {
      setBusyPlatform(null)
    }
  }

  async function syncPlatform(item: AdminMemberPlatformDetail) {
    if (!member) return
    setBusyPlatform(item.platform)
    setNotice('')
    try {
      await triggerAdminImmediateSync({
        memberId: member.id,
        platforms: [item.platform],
        triggerType: 'account_changed',
      })
      if (!demo) await loadMember(false)
      setNoticeKind('success')
      setNotice(`${platformLabels[item.platform]} 数据同步完成。`)
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '平台数据同步失败。')
    } finally {
      setBusyPlatform(null)
    }
  }

  const dialogTitle = dialog
    ? dialog.kind === 'account'
      ? `${dialog.item.accountId === null ? '绑定' : '修改'} ${platformLabels[dialog.item.platform]} 账号`
      : dialog.kind === 'manual'
        ? `手工录入 ${platformLabels[dialog.item.platform]} 数据`
        : `解绑 ${platformLabels[dialog.item.platform]} 账号`
    : ''

  return (
    <div className="admin-page admin-member-detail-page">
      <Link className="back-link" to="/admin/members">
        <ArrowLeft size={16} aria-hidden="true" />
        返回成员管理
      </Link>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}
      {loading ? <LoadingState label="正在读取成员详情" /> : null}

      {loaded && !loading && !member ? (
        <EmptyState title="成员不存在" description="该账号可能已删除，或不属于普通成员。" />
      ) : null}

      {!loading && member ? (
        <>
          <section className="admin-member-detail-header">
            <span className="member-avatar">{member.name.slice(-1)}</span>
            <div>
              <div className="admin-member-detail-title">
                <h1>{member.name}</h1>
                <span
                  className={`status ${member.status === 'active' ? 'status-verified' : 'status-suspended'}`}
                >
                  {member.status === 'active' ? '正常' : '已停用'}
                </span>
              </div>
              <p>{member.email}</p>
              <p>
                {member.grade} · {member.major} · QQ {member.qq}
              </p>
            </div>
            <dl>
              <div>
                <dt>平台注册</dt>
                <dd>{member.platformCount}</dd>
              </div>
              <div>
                <dt>已验证</dt>
                <dd>{member.verifiedPlatformCount}</dd>
              </div>
              <div>
                <dt>公开展示</dt>
                <dd>{member.isPublic ? '是' : '否'}</dd>
              </div>
              <div>
                <dt>注册时间</dt>
                <dd>{formatDateTime(member.joinedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="admin-section admin-member-platform-section">
            <div className="section-title-row">
              <div>
                <h2>平台账号与数据</h2>
                <p>账号变更后会回到待验证；手工数据会被下一次成功自动同步覆盖。</p>
              </div>
              <Link className="secondary-button" to="/admin/accounts">
                平台账号审核
              </Link>
            </div>

            <div className="compact-table-wrap admin-table-wrap">
              <table className="compact-table admin-members-table admin-member-platform-table">
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>账号</th>
                    <th>验证</th>
                    <th>当前分</th>
                    <th>最高分</th>
                    <th>通过题数</th>
                    <th>数据状态</th>
                    <th className="actions-column">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {member.platforms.map((item) => {
                    const busy = busyPlatform === item.platform
                    const isXcpc = item.platform === 'xcpc_elo'
                    const canSync =
                      item.accountId !== null &&
                      (item.accountStatus === 'verified' ||
                        (isXcpc && ['pending', 'invalid'].includes(item.accountStatus)))
                    return (
                      <tr key={item.platform} aria-busy={busy}>
                        <td data-label="平台">
                          <PlatformMark platform={item.platform} />
                        </td>
                        <td data-label="账号">
                          {item.externalId && (!isXcpc || item.accountStatus === 'verified') ? (
                            <a
                              className="admin-account-link"
                              href={platformUrls[item.platform](item.externalId)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span>
                                {isXcpc && item.accountStatus !== 'verified'
                                  ? '姓名自动匹配'
                                  : item.externalId}
                              </span>
                              <ExternalLink size={13} aria-hidden="true" />
                            </a>
                          ) : (
                            <span>{isXcpc ? '等待姓名匹配' : '未绑定'}</span>
                          )}
                          {item.verificationErrorMessage ? (
                            <small>{item.verificationErrorMessage}</small>
                          ) : null}
                        </td>
                        <td data-label="验证">
                          <span className={`status ${accountStatusClass(item.accountStatus)}`}>
                            {accountStatusLabels[item.accountStatus]}
                          </span>
                        </td>
                        <td data-label="当前分">
                          <strong>{formatInteger(item.currentRating)}</strong>
                        </td>
                        <td data-label="最高分">
                          <strong>{formatInteger(item.maxRating)}</strong>
                        </td>
                        <td data-label="通过题数">
                          <strong>{formatInteger(item.solvedCount)}</strong>
                        </td>
                        <td data-label="数据状态">
                          <span className={`status ${statStatusClass(item.statStatus)}`}>
                            {statStatusLabels[item.statStatus]}
                          </span>
                          <small>
                            {item.sourceVersion?.startsWith('admin-manual')
                              ? '手工录入'
                              : formatDateTime(item.lastSuccessAt)}
                          </small>
                        </td>
                        <td data-label="操作">
                          <div className="row-actions">
                            {!isXcpc ? (
                              <button
                                className="icon-button"
                                type="button"
                                title={item.accountId === null ? '绑定账号' : '修改账号'}
                                aria-label={`${item.accountId === null ? '绑定' : '修改'} ${platformLabels[item.platform]} 账号`}
                                disabled={busy}
                                onClick={() => openAccountDialog(item)}
                              >
                                {item.accountId === null ? (
                                  <Plus size={16} />
                                ) : (
                                  <Pencil size={16} />
                                )}
                              </button>
                            ) : null}
                            {!isXcpc &&
                            item.accountId !== null &&
                            (item.accountStatus === 'pending' ||
                              item.accountStatus === 'invalid') ? (
                              <button
                                className="icon-button approve-button"
                                type="button"
                                title="校验账号并同步"
                                aria-label={`验证 ${platformLabels[item.platform]} 账号`}
                                disabled={busy}
                                onClick={() => void verifyAccount(item)}
                              >
                                <CheckCircle2 size={16} />
                              </button>
                            ) : null}
                            <button
                              className="icon-button"
                              type="button"
                              title="同步平台数据"
                              aria-label={`同步 ${platformLabels[item.platform]} 数据`}
                              disabled={busy || !canSync}
                              onClick={() => void syncPlatform(item)}
                            >
                              <RefreshCw className={busy ? 'is-spinning' : undefined} size={16} />
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              title="手工录入数据"
                              aria-label={`手工录入 ${platformLabels[item.platform]} 数据`}
                              disabled={busy || item.accountStatus !== 'verified'}
                              onClick={() => openManualDialog(item)}
                            >
                              <Database size={16} />
                            </button>
                            {!isXcpc && item.accountId !== null ? (
                              <button
                                className="icon-button suspend-button"
                                type="button"
                                title="解绑账号"
                                aria-label={`解绑 ${platformLabels[item.platform]} 账号`}
                                disabled={busy}
                                onClick={() => openUnbindDialog(item)}
                              >
                                <Trash2 size={16} />
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
          </section>

          <section className="admin-section admin-member-activity-section">
            <div className="section-title-row">
              <div>
                <h2>最近活动</h2>
                <p>成员资料、平台绑定、手工数据和同步运行记录。</p>
              </div>
            </div>
            {member.activity.length === 0 ? (
              <EmptyState title="暂无活动记录" description="发生后台操作或同步后会显示在这里。" />
            ) : (
              <div className="admin-member-activity-list">
                {member.activity.map((activity) => (
                  <article key={activity.id}>
                    <time>{formatDateTime(activity.createdAt)}</time>
                    <div>
                      <strong>{activityTitle(activity)}</strong>
                      <small>{activityDescription(activity)}</small>
                    </div>
                    {activity.platform ? <PlatformMark platform={activity.platform} /> : <span />}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {dialog ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog admin-member-data-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="member-data-dialog-title"
            ref={dialogRef}
            onKeyDown={handleDialogKeyDown}
          >
            {dialog.kind === 'account' ? (
              <form onSubmit={saveAccount}>
                <div className="admin-dialog-header">
                  <h2 id="member-data-dialog-title">{dialogTitle}</h2>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="关闭对话框"
                    title="关闭"
                    disabled={savingDialog}
                    onClick={closeDialog}
                  >
                    <X size={17} />
                  </button>
                </div>
                <label className="admin-dialog-field">
                  <span>平台账号</span>
                  <input
                    autoFocus
                    required
                    maxLength={128}
                    value={externalId}
                    onChange={(event) => setExternalId(event.target.value)}
                  />
                </label>
                <p>保存后账号状态会变为待验证，旧统计数据将标记为不可用。</p>
                {dialogError ? (
                  <p className="form-error" role="status">
                    {dialogError}
                  </p>
                ) : null}
                <div className="admin-dialog-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={savingDialog}
                    onClick={closeDialog}
                  >
                    取消
                  </button>
                  <button className="primary-button" type="submit" disabled={savingDialog}>
                    <Save size={16} />
                    {savingDialog ? '保存中' : '保存账号'}
                  </button>
                </div>
              </form>
            ) : dialog.kind === 'manual' ? (
              <form onSubmit={saveManualStats}>
                <div className="admin-dialog-header">
                  <h2 id="member-data-dialog-title">{dialogTitle}</h2>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="关闭对话框"
                    title="关闭"
                    disabled={savingDialog}
                    onClick={closeDialog}
                  >
                    <X size={17} />
                  </button>
                </div>
                <p>手工数据会立即进入榜单和历史快照，并在下一次成功自动同步后被覆盖。</p>
                <div className="admin-member-edit-grid">
                  {ratingPlatforms.has(dialog.item.platform) ? (
                    <>
                      <label className="admin-dialog-field">
                        <span>当前 Rating</span>
                        <input
                          autoFocus
                          inputMode={dialog.item.platform === 'xcpc_elo' ? 'decimal' : 'numeric'}
                          min="0"
                          step={dialog.item.platform === 'xcpc_elo' ? '0.01' : '1'}
                          type="number"
                          value={currentRating}
                          onChange={(event) => setCurrentRating(event.target.value)}
                        />
                      </label>
                      <label className="admin-dialog-field">
                        <span>历史最高 Rating</span>
                        <input
                          inputMode={dialog.item.platform === 'xcpc_elo' ? 'decimal' : 'numeric'}
                          min="0"
                          step={dialog.item.platform === 'xcpc_elo' ? '0.01' : '1'}
                          type="number"
                          value={maxRating}
                          onChange={(event) => setMaxRating(event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  {solvedPlatforms.has(dialog.item.platform) ? (
                    <label className="admin-dialog-field">
                      <span>通过题数</span>
                      <input
                        autoFocus={!ratingPlatforms.has(dialog.item.platform)}
                        inputMode="numeric"
                        min="0"
                        step="1"
                        type="number"
                        value={solvedCount}
                        onChange={(event) => setSolvedCount(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label className="admin-dialog-field">
                    <span>数据时间</span>
                    <input
                      required
                      type="datetime-local"
                      value={sourceObservedAt}
                      onChange={(event) => setSourceObservedAt(event.target.value)}
                    />
                  </label>
                </div>
                <label className="admin-dialog-field">
                  <span>录入原因</span>
                  <textarea
                    required
                    maxLength={500}
                    rows={3}
                    value={manualNote}
                    onChange={(event) => setManualNote(event.target.value)}
                  />
                </label>
                {dialogError ? (
                  <p className="form-error" role="status">
                    {dialogError}
                  </p>
                ) : null}
                <div className="admin-dialog-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={savingDialog}
                    onClick={closeDialog}
                  >
                    取消
                  </button>
                  <button className="primary-button" type="submit" disabled={savingDialog}>
                    <Database size={16} />
                    {savingDialog ? '保存中' : '保存手工数据'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={confirmUnbind}>
                <div className="admin-dialog-header">
                  <h2 id="member-data-dialog-title">{dialogTitle}</h2>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="关闭对话框"
                    title="关闭"
                    disabled={savingDialog}
                    onClick={closeDialog}
                  >
                    <X size={17} />
                  </button>
                </div>
                <p>
                  解绑会永久删除该平台的当前统计和全部历史快照，同步运行记录仍会保留。此操作不能撤销。
                </p>
                {dialogError ? (
                  <p className="form-error" role="status">
                    {dialogError}
                  </p>
                ) : null}
                <div className="admin-dialog-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={savingDialog}
                    onClick={closeDialog}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button suspend-confirm-button"
                    type="submit"
                    disabled={savingDialog}
                  >
                    <Trash2 size={16} />
                    {savingDialog ? '解绑中' : '确认解绑'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
