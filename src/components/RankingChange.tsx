import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up'

interface RankingChangeProps {
  value: number | null
  label: string
  unit: string
}

const changeFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
})

export function RankingChange({ value, label, unit }: RankingChangeProps) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className="ranking-change is-unavailable" aria-label={`${label}暂无变化数据`}>
        --
      </span>
    )
  }

  if (value === 0) {
    return (
      <span className="ranking-change is-flat" aria-label={`${label}持平`}>
        0
      </span>
    )
  }

  const rising = value > 0
  const absoluteValue = changeFormatter.format(Math.abs(value))
  const description = `${label}${rising ? '上升' : '下降'} ${absoluteValue} ${unit}`

  return (
    <span
      className={`ranking-change ${rising ? 'is-up' : 'is-down'}`}
      aria-label={description}
      title={description}
    >
      {rising ? (
        <ArrowUp size={14} aria-hidden="true" />
      ) : (
        <ArrowDown size={14} aria-hidden="true" />
      )}
      <span>{absoluteValue}</span>
    </span>
  )
}
