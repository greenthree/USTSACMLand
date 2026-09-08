export const CONTEST_PLATFORM_LABELS = {
  'codeforces.com': 'Codeforces',
  'ac.nowcoder.com': '牛客',
  'atcoder.jp': 'AtCoder',
  'luogu.com.cn': '洛谷',
  'leetcode.com': 'LeetCode',
  'topcoder.com': 'Topcoder',
  'uoj.ac': 'UOJ',
  'qoj.ac': 'QOJ',
} as const

export type ContestPlatform = keyof typeof CONTEST_PLATFORM_LABELS

export interface ContestEvent {
  id: string
  name: string
  platform: ContestPlatform
  url: string
  startAt: string
  endAt: string
  introductory: boolean
}

export interface ContestWindow {
  startAt: Date
  endAt: Date
}

export type ContestStatus = 'ended' | 'live' | 'upcoming'

const DAY_MS = 86_400_000
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1_000

function beijingDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  )
  return { year: values.year, month: values.month, day: values.day }
}

export function getContestWindow(now = new Date()): ContestWindow {
  const { year, month, day } = beijingDateParts(now)
  const beijingMidnight = new Date(Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS)
  return {
    startAt: new Date(beijingMidnight.getTime() - 2 * DAY_MS),
    endAt: new Date(beijingMidnight.getTime() + 15 * DAY_MS - 1),
  }
}

export function getContestStatus(
  event: Pick<ContestEvent, 'startAt' | 'endAt'>,
  now = new Date(),
): ContestStatus {
  const start = Date.parse(event.startAt)
  const end = Date.parse(event.endAt)
  if (now.getTime() >= end) return 'ended'
  if (now.getTime() < start) return 'upcoming'
  return 'live'
}

export function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return days > 0
    ? `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function formatContestDuration(startAt: string, endAt: string): string {
  const milliseconds = Date.parse(endAt) - Date.parse(startAt)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '时间未知'

  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  const parts = [
    days > 0 ? `${days}天` : null,
    hours > 0 ? `${hours}小时` : null,
    minutes > 0 ? `${minutes}分钟` : null,
  ].filter(Boolean)

  return parts.join(' ')
}

export function formatBeijingDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '-')
}

export function isIntroductoryContest(name: string): boolean {
  return (
    /\bdiv\.?\s*[34]\b/i.test(name) ||
    /牛客周赛/.test(name) ||
    /atcoder\s+beginner\s+contest/i.test(name)
  )
}
