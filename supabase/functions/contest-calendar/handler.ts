import { isIntroductoryContest, parseContestCalendarApi, type OnlineContest } from './parser.ts'

export interface ContestCalendarWindow {
  startAt: Date
  endAt: Date
}
export interface ContestCalendarHandlerDependencies {
  fetchCalendarApi(url: string, window: ContestCalendarWindow): Promise<unknown>
  now?: () => Date
}

const DAY_MS = 86_400_000
const MAX_WINDOW_MS = 18 * DAY_MS
const CACHE_TTL_MS = 60 * 60 * 1_000
const MAX_CACHE_ENTRIES = 4
const SUCCESS_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=300'

interface ContestCalendarPayload {
  events: Array<OnlineContest & { introductory: boolean }>
  fetchedAt: string
  windowStart: string
  windowEnd: string
}

interface CachedContestCalendar {
  expiresAt: number
  payload: ContestCalendarPayload
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly messageForClient: string,
  ) {
    super(messageForClient)
  }
}
function responseHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  }
}
function response(body: unknown, status = 200, cacheable = false): Response {
  const headers = new Headers(responseHeaders())
  if (cacheable) headers.set('cache-control', SUCCESS_CACHE_CONTROL)
  return new Response(JSON.stringify(body), { status, headers })
}
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
export function defaultContestWindow(now: Date): ContestCalendarWindow {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid current time')
  const { year, month, day } = beijingDateParts(now)
  const beijingMidnight = new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1_000)
  return {
    startAt: new Date(beijingMidnight.getTime() - 2 * DAY_MS),
    endAt: new Date(beijingMidnight.getTime() + 15 * DAY_MS - 1),
  }
}
function parseDate(value: string | null): Date | null {
  if (
    !value ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
export function parseContestWindow(request: Request, _now: Date): ContestCalendarWindow {
  const url = new URL(request.url)
  for (const key of url.searchParams.keys())
    if (key !== 'start' && key !== 'end') throw new ApiError(400, '比赛窗口参数无效')
  const starts = url.searchParams.getAll('start')
  const ends = url.searchParams.getAll('end')
  if (starts.length > 1 || ends.length > 1) throw new ApiError(400, '比赛窗口参数无效')
  if (starts.length === 0 && ends.length === 0) return defaultContestWindow(_now)
  if (starts.length !== 1 || ends.length !== 1) throw new ApiError(400, '比赛窗口参数不完整')
  const startAt = parseDate(starts[0])
  const endAt = parseDate(ends[0])
  if (!startAt || !endAt || endAt <= startAt || endAt.getTime() - startAt.getTime() > MAX_WINDOW_MS)
    throw new ApiError(400, '比赛窗口参数无效')
  return { startAt, endAt }
}
function serializeContest(contest: OnlineContest): OnlineContest & { introductory: boolean } {
  return { ...contest, introductory: isIntroductoryContest(contest.name) }
}
export function createContestCalendarHandler(
  dependencies: ContestCalendarHandlerDependencies,
): (request: Request) => Promise<Response> {
  const now = dependencies.now ?? (() => new Date())
  const cache = new Map<string, CachedContestCalendar>()
  return async (request) => {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: responseHeaders() })
    if (request.method !== 'GET') return response({ error: 'Method not allowed' }, 405)
    try {
      const current = now()
      const window = parseContestWindow(request, current)
      const cacheKey = `${window.startAt.toISOString()}|${window.endAt.toISOString()}`
      const cached = cache.get(cacheKey)
      if (cached && cached.expiresAt > current.getTime()) {
        return response(cached.payload, 200, true)
      }
      const payload = await dependencies.fetchCalendarApi('', window)
      const events = parseContestCalendarApi(payload, window).map(serializeContest)
      const result: ContestCalendarPayload = {
        events,
        fetchedAt: current.toISOString(),
        windowStart: window.startAt.toISOString(),
        windowEnd: window.endAt.toISOString(),
      }
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value
        if (oldestKey) cache.delete(oldestKey)
      }
      cache.set(cacheKey, { expiresAt: current.getTime() + CACHE_TTL_MS, payload: result })
      return response(result, 200, true)
    } catch (error) {
      if (error instanceof ApiError)
        return response({ error: error.messageForClient }, error.status)
      return response({ error: '线上比赛数据暂时不可用' }, 503)
    }
  }
}
