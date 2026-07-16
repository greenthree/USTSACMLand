import type { KeyboardEvent } from 'react'
import { rankingViewLabels, type RankingView } from '../lib/platforms'

interface MetricTabsProps {
  platforms: readonly RankingView[]
  value: RankingView
  onChange: (value: RankingView) => void
  panelId?: string
}

export function MetricTabs({ platforms, value, onChange, panelId }: MetricTabsProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % platforms.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + platforms.length) % platforms.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = platforms.length - 1
    }

    if (nextIndex === null) return
    event.preventDefault()
    onChange(platforms[nextIndex])
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  return (
    <div className="platform-tabs" role="tablist" aria-label="数据平台">
      {platforms.map((platform, index) => (
        <button
          key={platform}
          type="button"
          role="tab"
          aria-selected={value === platform}
          aria-controls={panelId}
          tabIndex={value === platform ? 0 : -1}
          className={value === platform ? 'is-active' : undefined}
          onClick={() => onChange(platform)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {rankingViewLabels[platform]}
        </button>
      ))}
    </div>
  )
}
