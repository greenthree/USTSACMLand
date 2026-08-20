const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
})

const dailyArticleDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  timeZone: 'Asia/Shanghai',
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

export function formatShortDate(value: string | Date | null): string {
  if (!value) return '--'
  const date =
    typeof value === 'string' && !value.includes('T')
      ? new Date(`${value}T00:00:00+08:00`)
      : new Date(value)
  return shortDateFormatter.format(date)
}

export function formatDailyArticleDate(value: string | Date | null): string {
  if (!value) return '--'
  const date =
    typeof value === 'string' && !value.includes('T')
      ? new Date(`${value}T00:00:00+08:00`)
      : new Date(value)
  return dailyArticleDateFormatter.format(date)
}

export function formatBeijingDate(offsetDays = 0): string {
  const source = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(source)
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
