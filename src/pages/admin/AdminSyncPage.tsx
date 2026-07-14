import Play from 'lucide-react/dist/esm/icons/play'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { PlatformMark } from '../../components/PlatformMark'
import { StatusBadge } from '../../components/StatusBadge'
import { mockMembers, mockSyncRuns } from '../../data/mock'
import {
  fetchAdminOverview,
  fetchAdminSourceHealth,
  fetchAdminSyncRuns,
  groupSourceHealth,
  retryAdminSyncRun,
  triggerAdminFullSync,
} from '../../lib/adminOperations'
import { formatDateTime, formatDuration } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { SyncRun } from '../../types/domain'

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

function rateLabel(rate: number | null): string {
  return rate === null ? '--' : `${rate.toFixed(1)}%`
}

export function AdminSyncPage() {
  const demo = !supabase
  const [runs, setRuns] = useState<SyncRun[]>(() => (demo ? mockSyncRuns : []))
  const [healthGroups, setHealthGroups] = useState<SourceHealthGroup[]>(() =>
    demo ? demoHealthGroups : [],
  )
  const [overview, setOverview] = useState<AdminOverview | null>(() => (demo ? demoOverview : null))
  const [loading, setLoading] = useState(!demo)
  const [triggering, setTriggering] = useState(false)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [retryingRunIds, setRetryingRunIds] = useState<ReadonlySet<SyncRun['id']>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')

  const loadSyncData = useCallback(
    async (clearNotice = true): Promise<boolean> => {
      if (demo) return true

      setLoading(true)
      if (clearNotice) setNotice('')
      try {
        const [nextRuns, sourceHealth, nextOverview] = await Promise.all([
          fetchAdminSyncRuns(),
          fetchAdminSourceHealth(),
          fetchAdminOverview(),
        ])
        setRuns(nextRuns)
        setHealthGroups(groupSourceHealth(sourceHealth))
        setOverview(nextOverview)
        return true
      } catch (error) {
        setRuns([])
        setHealthGroups([])
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

  async function triggerAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTriggering(true)
    setNotice('')

    if (demo) {
      window.setTimeout(() => {
        setTriggering(false)
        setConfirmingAll(false)
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
        setNotice(
          result.failed === 0
            ? `同步完成，${result.succeeded} 个成员成功。`
            : `同步完成，${result.succeeded} 个成员成功，${result.failed} 个成员失败。`,
        )
      }
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : '全量同步失败。')
    } finally {
      setTriggering(false)
      setConfirmingAll(false)
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
        setNoticeKind(result.status === 'success' ? 'success' : 'error')
        setNotice(
          result.status === 'success'
            ? `已重新同步 ${run.memberName} 的 ${run.platform} 数据。`
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
  const canTriggerAll =
    !loading && !triggering && verifiedAccountCount !== null && verifiedAccountCount > 0

  return (
    <div className="admin-page" aria-busy={loading || triggering}>
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
            onClick={() => setConfirmingAll(true)}
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
        <div
          className="admin-dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !triggering) setConfirmingAll(false)
          }}
        >
          <section
            className="admin-dialog admin-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="full-sync-dialog-title"
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
                  className="secondary-button"
                  type="button"
                  disabled={triggering}
                  onClick={() => setConfirmingAll(false)}
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
    </div>
  )
}
