const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const integerFormatter = new Intl.NumberFormat('zh-CN')
const decimalFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatDateTime(value: string | null): string {
  if (!value) return '尚未同步'
  return dateTimeFormatter.format(new Date(value))
}

export function formatInteger(value: number | null): string {
  return value === null ? '--' : integerFormatter.format(value)
}

export function formatDecimal(value: number | null): string {
  return value === null ? '--' : decimalFormatter.format(value)
}

export function formatDuration(value: number | null): string {
  if (value === null) return '--'
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`
}
