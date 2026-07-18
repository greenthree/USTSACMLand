import Activity from 'lucide-react/dist/esm/icons/activity'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { PlatformMark } from '../../components/PlatformMark'
import { AdminFirecrawlKeysPanel } from '../../components/admin/AdminFirecrawlKeysPanel'
import { mockAdminSourceHealth } from '../../data/mock'
import { fetchAdminSourceHealth } from '../../lib/adminOperations'
import { formatDateTime, formatDuration } from '../../lib/format'
import { platformLabels } from '../../lib/platforms'
import { supabase } from '../../lib/supabase'
import { platforms, type AdminSourceHealth, type Platform } from '../../types/domain'

const lookbackOptions = [
  { hours: 24, label: '最近 24 小时' },
  { hours: 168, label: '最近 7 天' },
  { hours: 720, label: '最近 30 天' },
] as const

const credentialErrorCodes = new Set(['auth_required', 'auth_expired', 'not_configured'])
const structuralErrorCodes = new Set(['schema_changed', 'parse_failed'])

type HealthLevel = 'healthy' | 'degraded' | 'incident' | 'credential' | 'no-samples'

const healthLabels: Record<HealthLevel, string> = {
  healthy: '正常',
  degraded: '需关注',
  incident: '异常',
  credential: '凭据异常',
  'no-samples': '无样本',
}

function emptyHealth(platform: Platform): AdminSourceHealth {
  return {
    platform,
    totalRuns: 0,
    succeededRuns: 0,
    failedRuns: 0,
    successRate: null,
    averageDurationMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    latestErrorCode: null,
  }
}

function healthLevel(row: AdminSourceHealth): HealthLevel {
  if (row.totalRuns === 0) return 'no-samples'
  if (row.latestErrorCode && credentialErrorCodes.has(row.latestErrorCode)) return 'credential'
  if (row.latestErrorCode && structuralErrorCodes.has(row.latestErrorCode)) return 'incident'
  if (row.successRate !== null && row.successRate >= 98) return 'healthy'
  if (row.successRate !== null && row.successRate >= 90) return 'degraded'
  return 'incident'
}

function rateLabel(rate: number | null): string {
  return rate === null ? '--' : `${rate.toFixed(1)}%`
}

export function AdminSourceHealthPage() {
  const demo = !supabase
  const [lookbackHours, setLookbackHours] = useState(168)
  const [rows, setRows] = useState<AdminSourceHealth[]>(() => (demo ? mockAdminSourceHealth : []))
  const [loading, setLoading] = useState(!demo)
  const [errorMessage, setErrorMessage] = useState('')

  const loadHealth = useCallback(async () => {
    if (demo) return

    setLoading(true)
    setErrorMessage('')
    try {
      setRows(await fetchAdminSourceHealth(lookbackHours))
    } catch (error) {
      setRows([])
      setErrorMessage(error instanceof Error ? error.message : '数据源健康状态读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo, lookbackHours])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  const completeRows = useMemo(() => {
    const byPlatform = new Map(rows.map((row) => [row.platform, row]))
    return platforms.map((platform) => byPlatform.get(platform) ?? emptyHealth(platform))
  }, [rows])

  const summary = useMemo(() => {
    const completedRuns = completeRows.reduce((total, row) => total + row.totalRuns, 0)
    const failedRuns = completeRows.reduce((total, row) => total + row.failedRuns, 0)
    return {
      healthySources: completeRows.filter((row) => healthLevel(row) === 'healthy').length,
      credentialSources: completeRows.filter((row) => healthLevel(row) === 'credential').length,
      completedRuns,
      failedRuns,
    }
  }, [completeRows])

  const lookbackLabel =
    lookbackOptions.find((option) => option.hours === lookbackHours)?.label ?? '当前窗口'

  return (
    <div className="admin-page source-health-page" aria-busy={loading}>
      <section className="admin-page-heading">
        <div>
          <h1>数据源健康</h1>
          <p>按平台查看成功率、耗时、最近故障与凭据状态。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
          <label className="source-health-window-field">
            <span>统计窗口</span>
            <select
              value={lookbackHours}
              onChange={(event) => setLookbackHours(Number(event.target.value))}
              disabled={loading}
            >
              {lookbackOptions.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadHealth()}
            disabled={loading || demo}
          >
            <RefreshCw className={loading ? 'is-spinning' : undefined} size={15} />
            刷新
          </button>
        </div>
      </section>

      <AdminFirecrawlKeysPanel />

      {errorMessage ? (
        <p className="form-error admin-notice" role="status">
          {errorMessage}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取数据源健康状态" /> : null}

      {!loading && errorMessage ? (
        <EmptyState title="健康状态暂不可用" description="请稍后刷新页面重试。" />
      ) : null}

      {!loading && !errorMessage ? (
        <>
          <section className="health-summary-strip" aria-label="数据源健康摘要">
            <div>
              <ShieldCheck size={19} aria-hidden="true" />
              <span>正常数据源</span>
              <strong>{summary.healthySources}/6</strong>
            </div>
            <div>
              <Activity size={19} aria-hidden="true" />
              <span>已完成运行</span>
              <strong>{summary.completedRuns}</strong>
            </div>
            <div>
              <AlertTriangle size={19} aria-hidden="true" />
              <span>失败运行</span>
              <strong>{summary.failedRuns}</strong>
            </div>
            <div>
              <Clock3 size={19} aria-hidden="true" />
              <span>凭据异常源</span>
              <strong>{summary.credentialSources}</strong>
            </div>
          </section>

          <div className="source-health-explainer">
            <p>
              当前展示{lookbackLabel}
              内已结束的同步运行；“最近错误”只反映该窗口中的最新失败，不会覆盖最后一次成功数据。
            </p>
            <Link className="text-button" to="/admin/sync">
              打开同步中心
            </Link>
          </div>

          <section className="source-health-card-grid" aria-label="平台健康列表">
            {completeRows.map((row) => {
              const level = healthLevel(row)
              return (
                <article key={row.platform} aria-label={`${platformLabels[row.platform]} 健康状态`}>
                  <header>
                    <PlatformMark platform={row.platform} />
                    <span className={`health-level health-level-${level}`}>
                      {healthLabels[level]}
                    </span>
                  </header>
                  <div className="source-health-rate">
                    <strong>{rateLabel(row.successRate)}</strong>
                    <span>成功率</span>
                  </div>
                  <dl>
                    <div>
                      <dt>成功 / 总运行</dt>
                      <dd>
                        {row.succeededRuns} / {row.totalRuns}
                      </dd>
                    </div>
                    <div>
                      <dt>平均耗时</dt>
                      <dd>{formatDuration(row.averageDurationMs)}</dd>
                    </div>
                    <div>
                      <dt>最近成功</dt>
                      <dd>{formatDateTime(row.lastSuccessAt)}</dd>
                    </div>
                    <div>
                      <dt>最近失败</dt>
                      <dd>{formatDateTime(row.lastFailureAt)}</dd>
                    </div>
                  </dl>
                  <p className={row.latestErrorCode ? 'has-error' : undefined}>
                    最近错误：<code>{row.latestErrorCode ?? '--'}</code>
                  </p>
                </article>
              )
            })}
          </section>
        </>
      ) : null}
    </div>
  )
}
