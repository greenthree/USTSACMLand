import type { ReviewStatus, SyncStatus } from '../types/domain'

type BadgeStatus =
  ReviewStatus | SyncStatus | 'success' | 'running' | 'failed' | 'queued' | 'skipped'

const statusLabels: Record<BadgeStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  suspended: '已停用',
  fresh: '正常',
  stale: '已过期',
  error: '失败',
  missing: '未绑定',
  syncing: '同步中',
  success: '成功',
  running: '运行中',
  failed: '失败',
  queued: '排队中',
  skipped: '已跳过',
}

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const className = status === 'skipped' ? 'status-disabled' : `status-${status}`
  return <span className={`status ${className}`}>{statusLabels[status]}</span>
}
