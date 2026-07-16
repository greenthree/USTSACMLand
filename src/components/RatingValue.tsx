import type { CSSProperties } from 'react'
import { formatInteger } from '../lib/format'
import { platformLabels } from '../lib/platforms'
import { getRatingTier, ratingToneColors } from '../lib/ratingTiers'
import type { RatingPlatform } from '../types/domain'

interface RatingValueProps {
  platform: RatingPlatform
  value: number | null
  className?: string
  showTier?: boolean
}

export function RatingValue({ platform, value, className, showTier = true }: RatingValueProps) {
  const tier = getRatingTier(platform, value)
  const classes = ['rating-display', tier ? `rating-tone-${tier.tone}` : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  if (!tier || value === null) {
    return <span className={classes}>--</span>
  }

  return (
    <span
      className={classes}
      style={{ '--rating-color': ratingToneColors[tier.tone] } as CSSProperties}
      title={`${platformLabels[platform]} · ${tier.label}`}
    >
      <span className="rating-display-number">{formatInteger(value)}</span>
      {showTier ? (
        <small className="rating-tier-label">{tier.shortLabel}</small>
      ) : (
        <span className="sr-only">，{tier.label}</span>
      )}
    </span>
  )
}
