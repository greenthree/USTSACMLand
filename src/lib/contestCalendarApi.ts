import { supabaseUrl } from './supabase'
import {
  CONTEST_PLATFORM_LABELS,
  isIntroductoryContest,
  type ContestEvent,
  type ContestPlatform,
  type ContestWindow,
} from './contestCalendar'

export interface ContestCalendarResponse {
  events: ContestEvent[]
  fetchedAt: string
  windowStart: string
  windowEnd: string
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const MAX_EVENTS = 200
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

function isPlatform(value: unknown): value is ContestPlatform {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(CONTEST_PLATFORM_LABELS, value)
  )
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

function validContest(value: unknown): ContestEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    candidate.id.length > 512 ||
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.length > 300 ||
    !isPlatform(candidate.platform) ||
    typeof candidate.url !== 'string' ||
    !validIso(candidate.startAt) ||
    !validIso(candidate.endAt) ||
    Date.parse(candidate.endAt) <= Date.parse(candidate.startAt) ||
    typeof candidate.introductory !== 'boolean'
  ) {
    return null
  }
  let url: URL
  try {
    url = new URL(candidate.url)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (url.protocol !== 'https:' || host !== candidate.platform || url.pathname === '/') return null
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    platform: candidate.platform,
    url: url.toString(),
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    introductory: isIntroductoryContest(candidate.name.trim()),
  }
}

export function parseContestCalendarResponse(value: unknown): ContestCalendarResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('线上比赛数据格式无效')
  const payload = value as Record<string, unknown>
  if (
    !Array.isArray(payload.events) ||
    !validIso(payload.fetchedAt) ||
    !validIso(payload.windowStart) ||
    !validIso(payload.windowEnd)
  ) {
    throw new Error('线上比赛数据格式无效')
  }
  const events: ContestEvent[] = []
  const ids = new Set<string>()
  for (const value of payload.events.slice(0, MAX_EVENTS)) {
    const event = validContest(value)
    if (!event || ids.has(event.id)) continue
    ids.add(event.id)
    events.push(event)
  }
  events.sort((left, right) => left.startAt.localeCompare(right.startAt))
  return {
    events,
    fetchedAt: payload.fetchedAt,
    windowStart: payload.windowStart,
    windowEnd: payload.windowEnd,
  }
}

export async function fetchContestCalendar(
  window: ContestWindow,
  fetcher: Fetcher = fetch,
): Promise<ContestCalendarResponse> {
  if (!supabaseUrl) throw new Error('线上比赛服务尚未配置')
  const url = new URL(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/contest-calendar`)
  url.searchParams.set('start', window.startAt.toISOString())
  url.searchParams.set('end', window.endAt.toISOString())
  let response: Response
  try {
    response = await fetcher(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error('线上比赛服务暂时不可用')
  }
  if (!response.ok) throw new Error('线上比赛服务暂时不可用')
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('线上比赛数据格式无效')
  }
  return parseContestCalendarResponse(payload)
}
