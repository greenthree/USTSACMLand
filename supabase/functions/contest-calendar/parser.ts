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
export interface OnlineContest {
  id: string
  name: string
  platform: ContestPlatform
  url: string
  startAt: string
  endAt: string
}
export interface ContestWindow {
  startAt: Date
  endAt: Date
}
export interface ClistContestApiObject {
  id?: unknown
  resource?: unknown
  host?: unknown
  event?: unknown
  start?: unknown
  end?: unknown
  duration?: unknown
  href?: unknown
}
const MAX_CONTESTS = 200
const API_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, '')
}
function readPlatform(value: string): ContestPlatform | null {
  const host = normalizeHost(value)
  return Object.prototype.hasOwnProperty.call(CONTEST_PLATFORM_LABELS, host)
    ? (host as ContestPlatform)
    : null
}
export function isClistChallengePage(html: string): boolean {
  return /<title>\s*Just a moment|cf-chl-|challenge-platform/i.test(html)
}
function parseApiDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 64 || !API_DATE_PATTERN.test(value)) return null
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
function parseApiDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  const milliseconds = text.match(/^(\d+)$/)
  if (milliseconds) return Number(milliseconds[1])
  const clock = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/)
  if (clock) return (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0)) * 1000
  const units: Array<[RegExp, number]> = [
    [/^(\d+)\s+days?$/, 86400000],
    [/^(\d+)\s+hours?$/, 3600000],
    [/^(\d+)\s+minutes?$/, 60000],
  ]
  for (const [pattern, factor] of units) {
    const match = pattern.exec(text)
    if (match) return Number(match[1]) * factor
  }
  return null
}
function apiPlatform(value: unknown): ContestPlatform | null {
  if (typeof value !== 'string') return null
  try {
    return readPlatform(new URL(value).hostname)
  } catch {
    return readPlatform(value)
  }
}
function apiOfficialUrl(value: unknown, platform: ContestPlatform): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return readPlatform(url.hostname) === platform &&
      url.protocol === 'https:' &&
      url.pathname !== '/'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export function parseContestCalendarApi(payload: unknown, window: ContestWindow): OnlineContest[] {
  if (!payload || typeof payload !== 'object') return []
  const objects = (payload as { objects?: unknown }).objects
  const rows = Array.isArray(objects)
    ? objects
    : objects && typeof objects === 'object'
      ? (objects as { contest?: unknown }).contest
      : null
  if (!Array.isArray(rows)) return []
  const contests = new Map<string, OnlineContest>()
  for (const row of rows.slice(0, MAX_CONTESTS * 2)) {
    if (!row || typeof row !== 'object') continue
    const contest = row as ClistContestApiObject
    const platform = apiPlatform(contest.host) ?? apiPlatform(contest.resource)
    const name = typeof contest.event === 'string' ? contest.event.replace(/\s+/g, ' ').trim() : ''
    const start = parseApiDate(contest.start)
    const endFromApi = parseApiDate(contest.end)
    const duration = parseApiDuration(contest.duration)
    const end =
      endFromApi ?? (start && duration !== null ? new Date(start.getTime() + duration) : null)
    const url = platform ? apiOfficialUrl(contest.href, platform) : null
    if (
      !platform ||
      !name ||
      !start ||
      !end ||
      !url ||
      end <= start ||
      end < window.startAt ||
      start > window.endAt
    )
      continue
    const id =
      typeof contest.id === 'number' || typeof contest.id === 'string'
        ? String(contest.id)
        : `${url}:${start.toISOString()}`
    contests.set(id, {
      id: `${platform}:${id}`,
      name,
      platform,
      url,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    })
    if (contests.size >= MAX_CONTESTS) break
  }
  return [...contests.values()].sort((left, right) => left.startAt.localeCompare(right.startAt))
}

export function isIntroductoryContest(name: string): boolean {
  return (
    /\bdiv\.?\s*[34]\b/i.test(name) ||
    /牛客周赛/.test(name) ||
    /atcoder\s+beginner\s+contest/i.test(name)
  )
}
