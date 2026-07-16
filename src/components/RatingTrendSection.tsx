import { useId, useMemo, useState } from 'react'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'
import { RatingValue } from './RatingValue'
import { buildRatingTrendChartData } from '../lib/memberTrends'
import { platformLabels, ratingPlatforms } from '../lib/platforms'
import type { Member, RatingPlatform, RatingSnapshot } from '../types/domain'

const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
})

const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function shortDate(value: string): string {
  return shortDateFormatter.format(new Date(value))
}

function fullDate(value: string): string {
  return fullDateFormatter.format(new Date(value))
}

interface RatingTrendSectionProps {
  memberName: string
  snapshots: RatingSnapshot[]
  loading: boolean
  error: string | null
  demo: boolean
  memberStats?: Member['stats']
}

export function RatingTrendSection({
  memberName,
  snapshots,
  loading,
  error,
  demo,
  memberStats,
}: RatingTrendSectionProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<RatingPlatform>('codeforces')
  const chartTitleId = useId()
  const chartDescriptionId = useId()
  const panelId = useId()
  const platformSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.platform === selectedPlatform),
    [selectedPlatform, snapshots],
  )
  const counts = useMemo(() => {
    const result = new Map<RatingPlatform, number>()
    for (const platform of ratingPlatforms) result.set(platform, 0)
    for (const snapshot of snapshots) {
      result.set(snapshot.platform, (result.get(snapshot.platform) ?? 0) + 1)
    }
    return result
  }, [snapshots])
  const chart = useMemo(
    () => (platformSnapshots.length > 0 ? buildRatingTrendChartData(platformSnapshots) : null),
    [platformSnapshots],
  )
  const labelIndexes = useMemo(() => {
    if (!chart) return new Set<number>()
    return new Set([0, Math.floor((chart.points.length - 1) / 2), chart.points.length - 1])
  }, [chart])

  const platformLabel = platformLabels[selectedPlatform]
  const latestPoint = chart?.points.at(-1) ?? null
  const selectedStat = memberStats?.[selectedPlatform]
  const emptyDescription = !selectedStat?.externalId
    ? `尚未绑定 ${platformLabel} 账号。`
    : selectedStat.rating === null
      ? `已绑定 ${platformLabel}，但目前还没有有效 Rating。`
      : '当前 Rating 已可用，历史快照仍在积累；后续成功同步会自动补充。'

  return (
    <section className="trend-section" aria-labelledby="rating-trend-heading">
      <div className="section-title-row trend-title-row">
        <div>
          <h2 id="rating-trend-heading">Rating 趋势</h2>
          <p>按公开历史快照展示；重复的同源数据不会重复计点。</p>
        </div>
        <span className="trend-platform">{demo ? '演示历史' : '公开快照'}</span>
      </div>

      <div className="trend-platform-tabs" role="group" aria-label="Rating 趋势平台">
        {ratingPlatforms.map((platform) => (
          <button
            type="button"
            aria-pressed={selectedPlatform === platform}
            aria-controls={panelId}
            aria-label={`${platformLabels[platform]}，${counts.get(platform) ?? 0} 个历史点`}
            key={platform}
            onClick={() => setSelectedPlatform(platform)}
          >
            <span>{platformLabels[platform]}</span>
            <small>{counts.get(platform) ?? 0}</small>
          </button>
        ))}
      </div>

      <div id={panelId} role="region" aria-label={`${platformLabel} Rating 趋势`}>
        {loading ? <LoadingState label="正在读取 Rating 历史" /> : null}

        {!loading && error ? (
          <div className="trend-message" role="alert">
            <strong>Rating 历史暂不可用</strong>
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && !error && !chart ? (
          <EmptyState
            title={`暂无 ${platformLabel} Rating 历史`}
            description={
              memberStats
                ? emptyDescription
                : '完成首次有效 Rating 同步后，这里会自动显示历史变化。'
            }
          />
        ) : null}

        {!loading && !error && chart && latestPoint ? (
          <>
            <div
              className="trend-chart"
              data-platform={selectedPlatform}
              role="group"
              tabIndex={0}
              aria-label={`${memberName}的${platformLabel} Rating 趋势图，可横向滚动`}
            >
              <svg
                viewBox="0 0 800 232"
                role="img"
                aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
              >
                <title id={chartTitleId}>
                  {memberName}的{platformLabel} Rating 趋势
                </title>
                <desc id={chartDescriptionId}>
                  共 {chart.points.length} 个历史点，最低 {chart.minimum}，最高 {chart.maximum}
                  ，最新 {latestPoint.rating}。
                </desc>
                {chart.yTicks.map((tick) => (
                  <g className="trend-axis" key={tick.value}>
                    <line x1="70" x2="780" y1={tick.y} y2={tick.y} />
                    <text x="58" y={tick.y + 4} textAnchor="end">
                      {tick.value}
                    </text>
                  </g>
                ))}
                {chart.points.length > 1 ? (
                  <polyline
                    points={chart.points.map((point) => `${point.x},${point.y}`).join(' ')}
                  />
                ) : null}
                {chart.points.map((point, index) => (
                  <g key={`${point.id ?? 'snapshot'}-${point.recordedAt}-${index}`}>
                    <circle cx={point.x} cy={point.y} r="5">
                      <title>
                        {fullDate(point.sourceObservedAt ?? point.recordedAt)} · Rating{' '}
                        {point.rating}
                      </title>
                    </circle>
                    {labelIndexes.has(index) ? (
                      <text className="trend-date-label" x={point.x} y="220" textAnchor="middle">
                        {shortDate(point.sourceObservedAt ?? point.recordedAt)}
                      </text>
                    ) : null}
                  </g>
                ))}
              </svg>
            </div>

            <dl className="trend-summary" aria-label={`${platformLabel} Rating 历史摘要`}>
              <div>
                <dt>最新</dt>
                <dd>
                  <RatingValue platform={selectedPlatform} value={latestPoint.rating} />
                </dd>
              </div>
              <div>
                <dt>区间最低</dt>
                <dd>
                  <RatingValue platform={selectedPlatform} value={chart.minimum} />
                </dd>
              </div>
              <div>
                <dt>区间最高</dt>
                <dd>
                  <RatingValue platform={selectedPlatform} value={chart.maximum} />
                </dd>
              </div>
              <div>
                <dt>历史点</dt>
                <dd>{chart.points.length}</dd>
              </div>
            </dl>

            {chart.points.length === 1 ? (
              <p className="trend-single-point">
                目前只有 1 个历史点；至少积累 2 个点后才能观察 Rating 变化。
              </p>
            ) : null}

            <table className="sr-only">
              <caption>
                {memberName}的{platformLabel} Rating 历史明细
              </caption>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>Rating</th>
                  <th>当时最高 Rating</th>
                </tr>
              </thead>
              <tbody>
                {chart.points.map((point, index) => (
                  <tr key={`accessible-${point.id ?? 'snapshot'}-${point.recordedAt}-${index}`}>
                    <td>{fullDate(point.sourceObservedAt ?? point.recordedAt)}</td>
                    <td>{point.rating}</td>
                    <td>{point.peakRating ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </div>
    </section>
  )
}
