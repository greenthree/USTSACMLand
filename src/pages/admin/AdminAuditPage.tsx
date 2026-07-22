import Download from 'lucide-react/dist/esm/icons/download'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import { mockAuditEntries } from '../../data/mock'
import { buildAuditCsv, fetchAdminAuditEntries } from '../../lib/adminOperations'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { AuditEntry } from '../../types/domain'

export function AdminAuditPage() {
  const demo = !supabase
  const [entries, setEntries] = useState<AuditEntry[]>(() => (demo ? mockAuditEntries : []))
  const [loading, setLoading] = useState(!demo)
  const [errorMessage, setErrorMessage] = useState('')

  const loadEntries = useCallback(async () => {
    if (demo) return

    setLoading(true)
    setErrorMessage('')
    try {
      setEntries(await fetchAdminAuditEntries())
    } catch (error) {
      setEntries([])
      setErrorMessage(error instanceof Error ? error.message : '审计日志读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  function exportCsv() {
    if (entries.length === 0) return

    const url = URL.createObjectURL(
      new Blob([buildAuditCsv(entries)], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'usts-acm-land-audit.csv'
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <h1>审计日志</h1>
          <p>记录角色、平台账号、同步、推荐奖励和其他管理员操作。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
          <button
            className="secondary-button"
            type="button"
            onClick={exportCsv}
            disabled={loading || entries.length === 0}
          >
            <Download size={16} aria-hidden="true" />
            导出 CSV
          </button>
        </div>
      </section>

      {errorMessage ? (
        <p className="form-error admin-notice" role="status">
          {errorMessage}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取审计日志" /> : null}

      {!loading && entries.length === 0 ? (
        <EmptyState
          title="暂无审计日志"
          description="平台账号验证、绑定和手动同步操作会记录在这里。"
        />
      ) : null}

      {!loading && entries.length > 0 ? (
        <div className="audit-list">
          {entries.map((entry) => (
            <article className="audit-row" key={entry.id}>
              <span className="audit-time">{formatDateTime(entry.createdAt)}</span>
              <span className="audit-actor">{entry.actor}</span>
              <strong>{entry.action}</strong>
              <span>{entry.target}</span>
              <small>{entry.summary}</small>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
