import { rankingViewLabels, type RankingView } from '../lib/platforms'

interface MetricTabsProps {
  platforms: readonly RankingView[]
  value: RankingView
  onChange: (value: RankingView) => void
}

export function MetricTabs({ platforms, value, onChange }: MetricTabsProps) {
  return (
    <div className="platform-tabs" role="tablist" aria-label="数据平台">
      {platforms.map((platform) => (
        <button
          key={platform}
          type="button"
          role="tab"
          aria-selected={value === platform}
          className={value === platform ? 'is-active' : undefined}
          onClick={() => onChange(platform)}
        >
          {rankingViewLabels[platform]}
        </button>
      ))}
    </div>
  )
}
