import type { Platform } from '../types/domain'
import { platformLabels } from '../lib/platforms'

const shortLabels: Record<Platform, string> = {
  codeforces: 'CF',
  nowcoder: 'NC',
  atcoder: 'AT',
  xcpc_elo: 'ELO',
  luogu: 'LG',
  qoj: 'QOJ',
}

export function PlatformMark({
  platform,
  withLabel = true,
}: {
  platform: Platform
  withLabel?: boolean
}) {
  return (
    <span className="platform-mark-wrap">
      <span className={`platform-mark platform-${platform}`} aria-hidden="true">
        {shortLabels[platform]}
      </span>
      {withLabel ? <span>{platformLabels[platform]}</span> : null}
    </span>
  )
}
