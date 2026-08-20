interface TableSkeletonProps {
  label?: string
  rowCount?: number
  className?: string
}

export function TableSkeleton({
  label = '正在读取公开榜单',
  rowCount = 8,
  className = '',
}: TableSkeletonProps) {
  return (
    <div
      className={`table-skeleton-wrap ${className}`.trim()}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <div className="table-skeleton-header">
        <span className="loading-spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="table-skeleton" aria-hidden="true">
        {Array.from({ length: rowCount }).map((_, index) => (
          <div className="skeleton-row" key={index}>
            <div className="skeleton-cell skeleton-rank" />
            <div className="skeleton-cell skeleton-avatar" />
            <div className="skeleton-cell skeleton-member">
              <div className="skeleton-line skeleton-name" />
              <div className="skeleton-line skeleton-grade" />
            </div>
            <div className="skeleton-cell skeleton-major" />
            <div className="skeleton-cell skeleton-account" />
            <div className="skeleton-cell skeleton-metric" />
            <div className="skeleton-cell skeleton-status" />
          </div>
        ))}
      </div>
    </div>
  )
}
