import Play from 'lucide-react/dist/esm/icons/play'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { PlatformMark } from '../../components/PlatformMark'
import { StatusBadge } from '../../components/StatusBadge'
import { mockMembers, mockSyncRuns } from '../../data/mock'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import {
  fetchAdminActiveSyncJobs,
  fetchAdminOverview,
  fetchAdminSourceHealth,
  fetchAdminSyncRuns,
  groupSourceHealth,
  retryAdminSyncRun,
  triggerAdminFullSync,
  triggerAdminScopedSync,
  type AdminScopedSyncTarget,
} from '../../lib/adminOperations'
import { fetchAdminMembers } from '../../lib/adminMembers'
import { formatDateTime, formatDuration } from '../../lib/format'
import { platformLabels } from '../../lib/platforms'
import { supabase } from '../../lib/supabase'
import {
  platforms,
  type AdminMember,
  type AdminSyncBatchResult,
  type Platform,
  type SyncQueueJob,
  type SyncRun,
  type SyncTriggerType,
} from '../../types/domain'

type AdminOverview = Awaited<ReturnType<typeof fetchAdminOverview>>
type SourceHealthGroup = ReturnType<typeof groupSourceHealth>[number]

const demoHealthGroups: SourceHealthGroup[] = [
  {
    id: 'official-api',
    label: '官方 API',
    platforms: ['codeforces', 'atcoder'],
    platformLabel: 'CF / AtCoder',
    totalRuns: 1_000,
    succeededRuns: 998,
    failedRuns: 2,
    successRate: 99.8,
    averageDurationMs: 1_840,
    lastSuccessAt: '2026-07-12T18:20:00+08:00',
    lastFailureAt: null,
    latestErrorCode: null,
  },
  {
    id: 'page-parsing',
    label: '页面解析',
    platforms: ['nowcoder', 'luogu', 'xcpc_elo'],
    platformLabel: '牛客 / 洛谷 / XCPC ELO',
    totalRuns: 500,
    succeededRuns: 481,
    failedRuns: 19,
    successRate: 96.2,
    averageDurationMs: 2_760,
    lastSuccessAt: '2026-07-12T18:18:00+08:00',
    lastFailureAt: '2026-07-12T17:42:00+08:00',
    latestErrorCode: 'schema_changed',
  },
  {
    id: 'authenticated-browser',
    label: '认证浏览器',
    platforms: ['qoj'],
    platformLabel: 'QOJ',
    totalRuns: 500,
    succeededRuns: 457,
    failedRuns: 43,
    successRate: 91.4,
    averageDurationMs: 30_000,
    lastSuccessAt: '2026-07-12T16:30:00+08:00',
    lastFailureAt: '2026-07-12T18:16:00+08:00',
    latestErrorCode: 'auth_expired',
  },
]

const demoOverview: AdminOverview = {
  approvedMemberCount: mockMembers.length,
  pendingMemberCount: 0,
  failedJobCount24h: mockSyncRuns.filter((run) => run.status === 'failed').length,
  runningJobCount: mockSyncRuns.filter((run) => run.status === 'running').length,
  overdueStatCount: 2,
  credentialErrorCount: 1,
  verifiedAccountCount: mockMembers.reduce(
    (total, member) =>
      total + Object.values(member.stats).filter((stat) => stat.externalId.length > 0).length,
    0,
  ),
}

const demoQueueJobs: SyncQueueJob[] = [
  {
    id: 31,
    profileId: mockMembers[0]?.id ?? null,
    memberName: mockMembers[0]?.name ?? '演示成员',
    scope: 'account',
    platform: 'codeforces',
    status: 'queued',
    triggerType: 'scheduled',
    attemptCount: 1,
    maxAttempts: 3,
    scheduledAt: '2026-07-12T18:24:00+08:00',
    startedAt: null,
    createdAt: '2026-07-12T18:20:00+08:00',
    errorCode: 'timeout',
  },
]

const demoMembers: AdminMember[] = mockMembers.map((member) => {
  const platformCount = Object.values(member.stats).filter(
    (stat) => stat.externalId.length > 0,
  ).length
  return {
    id: member.id,
    name: member.name,
    email: `${member.id}@demo.local`,
    qq: '--',
    major: member.major,
    grade: member.grade,
    role: 'member',
    status: 'active',
    suspensionNote: null,
    isPublic: true,
    joinedAt: member.joinedAt,
    updatedAt: member.joinedAt,
    platformCount,
    verifiedPlatformCount: platformCount,
  }
})

const triggerLabels: Record<SyncTriggerType, string> = {
  scheduled: '定时任务',
  manual: '手动',
  registration: '注册同步',
  account_changed: '账号变更',
  retry: '手动重试',
}

function rateLabel(rate: number | null): string {
  return rate === null ? '--' : `${rate.toFixed(1)}%`
}

function batchResultNotice(result: AdminSyncBatchResult, targetLabel: string): string {
  if (result.failed > 0) {
    return `${targetLabel}同步完成，${result.succeeded} 个平台账号成功，${result.queued} 个等待重试，${result.failed} 个失败。`
  }
  if (result.queued > 0) {
    return `${targetLabel}本轮完成，${result.succeeded} 个平台账号成功，${result.queued} 个已按退避策略加入重试队列。`
  }
  return `${targetLabel}同步完成，${result.succeeded} 个平台账号成功。`
}

export function AdminSyncPage() {
  const demo = !supabase
  const [runs, setRuns] = useState<SyncRun[]>(() => (demo ? mockSyncRuns : []))
  const [queueJobs, setQueueJobs] = useState<SyncQueueJob[]>(() => (demo ? demoQueueJobs : []))
  const [healthGroups, setHealthGroups] = useState<SourceHealthGroup[]>(() =>
    demo ? demoHealthGroups : [],
  )
  const [members, setMembers] = useState<AdminMember[]>(() => (demo ? demoMembers : []))
  const [overview, setOverview] = useState<AdminOverview | null>(() => (demo ? demoOverview : null))
  const [loading, setLoading] = useState(!demo)
  const [triggering, setTriggering] = useState(false)
  const [targeting, setTargeting] = useState(false)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [confirmingTarget, setConfirmingTarget] = useState<AdminScopedSyncTarget | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState(() =>
    demo
      ? (demoMembers.find(
          (member) => member.status === 'active' && member.verifiedPlatformCount > 0,
        )?.id ?? '')
      : '',
  )
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('codeforces')
  const [retryingRunIds, setRetryingRunIds] = useState<ReadonlySet<SyncRun['id']>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const { closeDialog, dialogRef, handleDialogKeyDown, rememberDialogTrigger } = useDialogFocus()

  const loadSyncData = useCallback(
    async (clearNotice = true): Promise<boolean> => {
      if (demo) return true

      setLoading(true)
      if (clearNotice) setNotice('')
      try {
        const [nextRuns, nextQueueJobs, sourceHealth, nextOverview, nextMembers] =
          await Promise.all([
            fetchAdminSyncRuns(),
            fetchAdminActiveSyncJobs(),
            fetchAdminSourceHealth(),
            fetchAdminOverview(),
            fetchAdminMembers(),
          ])
        setRuns(nextRuns)
        setQueueJobs(nextQueueJobs)
        setHealthGroups(groupSourceHealth(sourceHealth))
        setOverview(nextOverview)
        setMembers(nextMembers)
        setSelectedMemberId((current) => {
          if (nextMembers.some((member) => member.id === current && member.status === 'active')) {
            return current
          }
          return (
            nextMembers.find(
              (member) => member.status === 'active' && member.verifiedPlatformCount > 0,
            )?.id ?? ''
          )
        })
        return true
      } catch (error) {
        setRuns([])
        setQueueJobs([])
        setHealthGroups([])
        setMembers([])
        setOverview(null)
        setNoticeKind('error')
        setNotice(error instanceof Error ? error.message : '同步中心数据读取失败。')
        return false
      } finally {
        setLoading(false)
      }
    },
    [demo],
  )

  useEffect(() => {
    void loadSyncData()
  }, [loadSyncData])

  function openFullSyncDialog(trigger: HTMLButtonElement) {
    rememberDialogTrigger(trigger)
    setConfirmingAll(true)
  }

  function closeFullSyncDialog() {
    closeDialog(() => setConfirmingAll(false))
  }

  function openTargetSyncDialog(target: AdminScopedSyncTarget, trigger: HTMLButtonElement) {
    rememberDialogTrigger(trigger)
    setConfirmingTarget(target)
  }

  function closeTargetSyncDialog() {
    closeDialog(() => setConfirmingTarget(null))
  }

  async function triggerAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTriggering(true)
    setNotice('')

    if (demo) {
      window.setTimeout(() => {
        setTriggering(false)
        closeFullSyncDialog()
        setNoticeKind('success')
        setNotice('演示同步已完成。')
      }, 900)
      return
    }

    try {
      const result = await triggerAdminFullSync()
      const refreshed = await loadSyncData(false)
      if (refreshed) {
        setNoticeKind(result.failed === 0 ? 'success' : 'error')
        setNotice(batchResultNotice(result, ''))
      }
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '全量同步失败。')
    } finally {
      setTriggering(false)
      closeFullSyncDialog()
    }
  }

  async function triggerTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmingTarget) return

    const target = confirmingTarget
    const member =
      target.scope === 'member' ? members.find((item) => item.id === target.memberId) : null
    const targetLabel =
      target.scope === 'member'
        ? `${member?.name ?? '该成员'}：`
        : `${platformLabels[target.platform]}：`
    setTargeting(true)
    setNotice('')

    if (demo) {
      window.setTimeout(() => {
        setTargeting(false)
        closeTargetSyncDialog()
        setNoticeKind('success')
        setNotice(`${targetLabel}演示同步已完成。`)
      }, 700)
      return
    }

    try {
      const result = await triggerAdminScopedSync(target)
      const refreshed = await loadSyncData(false)
      if (refreshed) {
        setNoticeKind(result.failed === 0 ? 'success' : 'error')
        setNotice(batchResultNotice(result, targetLabel))
      }
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '范围同步失败。')
    } finally {
      setTargeting(false)
      closeTargetSyncDialog()
    }
  }

  async function retry(run: SyncRun) {
    setRetryingRunIds((current) => new Set(current).add(run.id))
    setNotice('')

    if (demo) {
      setRuns((current) =>
        current.map((item) =>
          item.id === run.id
            ? { ...item, status: 'running', errorCode: null, durationMs: null }
            : item,
        ),
      )
      window.setTimeout(() => {
        setRuns((current) =>
          current.map((item) =>
            item.id === run.id
              ? {
                  ...item,
                  status: 'success',
                  jobStatus: 'succeeded',
                  durationMs: 1_200,
                  finishedAt: new Date().toISOString(),
                }
              : item,
          ),
        )
        setRetryingRunIds((current) => {
          const next = new Set(current)
          next.delete(run.id)
          return next
        })
        setNoticeKind('success')
        setNotice(`已重新同步 ${run.memberName} 的 ${run.platform} 数据。`)
      }, 700)
      return
    }

    try {
      const result = await retryAdminSyncRun(run)
      const refreshed = await loadSyncData(false)
      if (refreshed) {
        setNoticeKind(result.status === 'failed' ? 'error' : 'success')
        setNotice(
          result.status === 'success'
            ? `已重新同步 ${run.memberName} 的 ${run.platform} 数据。`
            : result.status === 'queued'
              ? `${run.memberName} 的 ${run.platform} 数据仍受临时故障影响，已加入重试队列。`
              : `${run.memberName} 的 ${run.platform} 数据重试后仍失败，请查看最新错误。`,
        )
      }
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '同步重试失败。')
    } finally {
      setRetryingRunIds((current) => {
        const next = new Set(current)
        next.delete(run.id)
        return next
      })
    }
  }

  const verifiedAccountCount = overview?.verifiedAccountCount ?? null
  const selectableMembers = members.filter(
    (member) => member.status === 'active' && member.verifiedPlatformCount > 0,
  )
  const canTriggerAll =
    !loading &&
    !triggering &&
    !targeting &&
    verifiedAccountCount !== null &&
    verifiedAccountCount > 0
  const selectedMember = selectableMembers.find((member) => member.id === selectedMemberId) ?? null

  return (
    <div className="admin-page" aria-busy={loading || triggering || targeting}>
      <section className="admin-page-heading">
        <div>
          <h1>同步中心</h1>
          <p>查看任务进度、结构化错误与最近成功时间。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
          <button
            className="primary-button"
            type="button"
            onClick={(event) => openFullSyncDialog(event.currentTarget)}
            disabled={!canTriggerAll}
          >
            {triggering ? <RefreshCw className="is-spinning" size={16} /> : <Play size={16} />}
            {triggering ? '正在同步' : '同步全部成员'}
          </button>
        </div>
      </section>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取同步中心" /> : null}

      {!loading && !overview ? (
        <EmptyState title="同步中心暂不可用" description="请稍后刷新页面重试。" />
      ) : null}

      {!loading && overview ? (
        <>
          <section className="source-health-grid" aria-label="数据源健康状态">
            {healthGroups.map((group) => (
              <div key={group.id}>
                <span>{group.label}</span>
                <strong>{rateLabel(group.successRate)}</strong>
                <small>{group.platformLabel}</small>
                <small className="source-health-detail">
                  {group.totalRuns === 0 && group.id === 'authenticated-browser' && !demo
                    ? 'QOJ Worker 未接入'
                    : group.totalRuns === 0
                      ? '近 7 天暂无样本'
                      : `${group.succeededRuns}/${group.totalRuns} 次成功 · 平均 ${formatDuration(group.averageDurationMs)}`}
                </small>
                {group.latestErrorCode ? (
                  <small className="source-health-error">最近错误：{group.latestErrorCode}</small>
                ) : null}
              </div>
            ))}
          </section>

          {overview.credentialErrorCount > 0 ? (
            <p className="sync-health-warning" role="status">
              检测到 {overview.credentialErrorCount} 个凭据相关错误，请先检查对应数据源配置。
            </p>
          ) : null}

          <section className="sync-trigger-panel" aria-labelledby="sync-trigger-title">
            <div className="sync-section-heading">
              <div>
                <h2 id="sync-trigger-title">按范围同步</h2>
                <p>选择一个成员同步其全部已验证账号，或选择一个平台同步所有正常成员。</p>
              </div>
            </div>
            <div className="sync-target-grid">
              <div className="sync-target-card">
                <div>
                  <strong>按成员</strong>
                  <small>同步该成员当前所有已验证平台账号。</small>
                </div>
                <div className="sync-target-controls">
                  <select
                    aria-label="选择同步成员"
                    value={selectedMemberId}
                    onChange={(event) => setSelectedMemberId(event.target.value)}
                    disabled={loading || targeting || triggering || selectableMembers.length === 0}
                  >
                    {selectableMembers.length === 0 ? (
                      <option value="">暂无可同步成员</option>
                    ) : null}
                    {selectableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}（{member.verifiedPlatformCount} 个账号）
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!selectedMember || loading || targeting || triggering}
                    onClick={(event) =>
                      selectedMember &&
                      openTargetSyncDialog(
                        { scope: 'member', memberId: selectedMember.id },
                        event.currentTarget,
                      )
                    }
                  >
                    <Play size={15} />
                    同步该成员
                  </button>
                </div>
              </div>

              <div className="sync-target-card">
                <div>
                  <strong>按平台</strong>
                  <small>同步所有正常成员在该平台的已验证账号。</small>
                </div>
                <div className="sync-target-controls">
                  <select
                    aria-label="选择同步平台"
                    value={selectedPlatform}
                    onChange={(event) => setSelectedPlatform(event.target.value as Platform)}
                    disabled={loading || targeting || triggering}
                  >
                    {platforms.map((platform) => (
                      <option key={platform} value={platform}>
                        {platformLabels[platform]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loading || targeting || triggering}
                    onClick={(event) =>
                      openTargetSyncDialog(
                        { scope: 'platform', platform: selectedPlatform },
                        event.currentTarget,
                      )
                    }
                  >
                    <Play size={15} />
                    同步该平台
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="sync-queue-panel" aria-labelledby="sync-queue-title">
            <div className="sync-section-heading">
              <div>
                <h2 id="sync-queue-title">当前任务队列</h2>
                <p>展示等待执行和正在运行的持久任务，包括下一次执行时间与尝试次数。</p>
              </div>
              <span>{queueJobs.length} 个活动任务</span>
            </div>

            {queueJobs.length === 0 ? (
              <p className="sync-queue-empty">当前没有排队或运行中的同步任务。</p>
            ) : (
              <div className="compact-table-wrap admin-table-wrap">
                <table className="compact-table sync-table" aria-label="活动同步任务">
                  <thead>
                    <tr>
                      <th>状态</th>
                      <th>成员</th>
                      <th>平台</th>
                      <th>触发方式</th>
                      <th>尝试</th>
                      <th>执行时间</th>
                      <th>最近错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueJobs.map((job) => (
                      <tr key={job.id}>
                        <td data-label="状态">
                          <StatusBadge status={job.status} />
                        </td>
                        <td data-label="成员">{job.memberName}</td>
                        <td data-label="平台">
                          {job.platform ? <PlatformMark platform={job.platform} /> : '多平台'}
                        </td>
                        <td data-label="触发方式">{triggerLabels[job.triggerType]}</td>
                        <td data-label="尝试">
                          {job.attemptCount}/{job.maxAttempts}
                        </td>
                        <td data-label="执行时间">
                          {job.status === 'running' && job.startedAt
                            ? `开始于 ${formatDateTime(job.startedAt)}`
                            : formatDateTime(job.scheduledAt)}
                        </td>
                        <td data-label="最近错误">
                          <code>{job.errorCode ?? '--'}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {runs.length === 0 ? (
            <EmptyState title="暂无同步记录" description="执行首次同步后，运行结果会显示在这里。" />
          ) : (
            <div className="compact-table-wrap admin-table-wrap">
              <table className="compact-table sync-table">
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>成员</th>
                    <th>开始时间</th>
                    <th>耗时</th>
                    <th>错误详情</th>
                    <th>状态</th>
                    <th className="actions-column">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const retrying = retryingRunIds.has(run.id)
                    return (
                      <tr aria-busy={retrying} key={run.id}>
                        <td data-label="平台">
                          <PlatformMark platform={run.platform} />
                        </td>
                        <td data-label="成员">{run.memberName}</td>
                        <td data-label="开始时间">{formatDateTime(run.startedAt)}</td>
                        <td data-label="耗时">{formatDuration(run.durationMs)}</td>
                        <td className="sync-error-cell" data-label="错误详情">
                          <code>{run.errorCode ?? '--'}</code>
                          {run.errorMessage ? (
                            <small className="sync-error-message">{run.errorMessage}</small>
                          ) : null}
                        </td>
                        <td data-label="状态">
                          <StatusBadge status={run.status} />
                        </td>
                        <td data-label="操作">
                          <button
                            className="icon-button"
                            type="button"
                            title="重试"
                            aria-label={`重试 ${run.memberName} 的同步任务`}
                            disabled={run.status !== 'failed' || retrying}
                            onClick={() => void retry(run)}
                          >
                            <RotateCcw className={retrying ? 'is-spinning' : undefined} size={16} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {confirmingAll && verifiedAccountCount !== null ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog admin-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="full-sync-dialog-title"
            ref={dialogRef}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, () => setConfirmingAll(false), triggering)
            }
          >
            <form onSubmit={(event) => void triggerAll(event)}>
              <div className="admin-dialog-header">
                <h2 id="full-sync-dialog-title">同步全部成员</h2>
              </div>
              <p>
                本次将访问 {verifiedAccountCount}{' '}
                个已验证平台账号。同步会立即执行，并可能持续一段时间。
              </p>
              <div className="admin-dialog-actions">
                <button
                  autoFocus
                  className="secondary-button"
                  type="button"
                  disabled={triggering}
                  onClick={closeFullSyncDialog}
                >
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={triggering}>
                  {triggering ? (
                    <RefreshCw className="is-spinning" size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  {triggering ? '正在同步' : '确认同步'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirmingTarget ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-dialog admin-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="target-sync-dialog-title"
            ref={dialogRef}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, () => setConfirmingTarget(null), targeting)
            }
          >
            <form onSubmit={(event) => void triggerTarget(event)}>
              <div className="admin-dialog-header">
                <h2 id="target-sync-dialog-title">
                  {confirmingTarget.scope === 'member' ? '同步指定成员' : '同步指定平台'}
                </h2>
              </div>
              <p>
                {confirmingTarget.scope === 'member'
                  ? `将同步 ${members.find((member) => member.id === confirmingTarget.memberId)?.name ?? '该成员'} 的全部已验证平台账号。`
                  : `将同步所有正常成员的 ${platformLabels[confirmingTarget.platform]} 已验证账号。`}
                同步会立即访问对应的外部数据源。
              </p>
              <div className="admin-dialog-actions">
                <button
                  autoFocus
                  className="secondary-button"
                  type="button"
                  disabled={targeting}
                  onClick={closeTargetSyncDialog}
                >
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={targeting}>
                  {targeting ? <RefreshCw className="is-spinning" size={16} /> : <Play size={16} />}
                  {targeting ? '正在同步' : '确认同步'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
