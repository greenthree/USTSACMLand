import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import IdCard from 'lucide-react/dist/esm/icons/id-card'
import Users from 'lucide-react/dist/esm/icons/users'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminReferralProgramPanel } from '../../components/admin/AdminReferralProgramPanel'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { PlatformMark } from '../../components/PlatformMark'
import { StatusBadge } from '../../components/StatusBadge'
import { mockMembers, mockSyncRuns } from '../../data/mock'
import { fetchAdminOverview, fetchAdminSyncRuns } from '../../lib/adminOperations'
import { formatDuration } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { SyncRun } from '../../types/domain'

type AdminOverview = Awaited<ReturnType<typeof fetchAdminOverview>>

const demoOverview: AdminOverview = {
  approvedMemberCount: mockMembers.length,
  pendingMemberCount: 0,
  failedJobCount24h: mockSyncRuns.filter((run) => run.status === 'failed').length,
  runningJobCount: mockSyncRuns.filter((run) => run.status === 'running').length,
  overdueStatCount: 2,
  credentialErrorCount: mockSyncRuns.filter((run) => run.errorCode === 'auth_expired').length,
  verifiedAccountCount: mockMembers.reduce(
    (total, member) =>
      total + Object.values(member.stats).filter((stat) => stat.externalId.length > 0).length,
    0,
  ),
}

export function AdminOverviewPage() {
  const demo = !supabase
  const [overview, setOverview] = useState<AdminOverview | null>(() => (demo ? demoOverview : null))
  const [recentRuns, setRecentRuns] = useState<SyncRun[]>(() => (demo ? mockSyncRuns : []))
  const [loading, setLoading] = useState(!demo)
  const [errorMessage, setErrorMessage] = useState('')

  const loadOverview = useCallback(async () => {
    if (demo) return

    setLoading(true)
    setErrorMessage('')
    try {
      const [nextOverview, runs] = await Promise.all([fetchAdminOverview(), fetchAdminSyncRuns(5)])
      setOverview(nextOverview)
      setRecentRuns(runs)
    } catch (error) {
      setOverview(null)
      setRecentRuns([])
      setErrorMessage(error instanceof Error ? error.message : '后台概览读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <h1>后台概览</h1>
          <p>成员账号、数据同步与凭据健康状态。</p>
        </div>
        <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
      </section>

      <AdminReferralProgramPanel />

      {errorMessage ? (
        <p className="form-error admin-notice" role="status">
          {errorMessage}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取后台概览" /> : null}

      {!loading && !overview ? (
        <EmptyState title="概览数据暂不可用" description="请稍后刷新页面重试。" />
      ) : null}

      {!loading && overview ? (
        <>
          <section className="admin-metric-strip" aria-label="后台指标">
            <div>
              <Users size={19} aria-hidden="true" />
              <span>成员账号</span>
              <strong>{overview.approvedMemberCount}</strong>
            </div>
            <div>
              <IdCard size={19} aria-hidden="true" />
              <span>已验证平台账号</span>
              <strong>{overview.verifiedAccountCount}</strong>
            </div>
            <div>
              <AlertTriangle size={19} aria-hidden="true" />
              <span>24 小时失败任务</span>
              <strong>{overview.failedJobCount24h}</strong>
            </div>
            <div>
              <Clock3 size={19} aria-hidden="true" />
              <span>过期数据</span>
              <strong>{overview.overdueStatCount}</strong>
            </div>
          </section>

          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h2>最近同步</h2>
                <p>显示最新运行和结构化错误码。</p>
              </div>
              <Link className="text-button" to="/admin/sync">
                打开同步中心 <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            {recentRuns.length === 0 ? (
              <EmptyState title="暂无同步记录" description="首次同步完成后会显示运行结果。" />
            ) : (
              <div className="sync-run-list">
                {recentRuns.map((run) => (
                  <div className="sync-run-row" key={run.id}>
                    <PlatformMark platform={run.platform} />
                    <strong>{run.memberName}</strong>
                    <span>{formatDuration(run.durationMs)}</span>
                    <span>{run.errorCode ?? '--'}</span>
                    <StatusBadge status={run.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
