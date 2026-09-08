import { createContestCalendarHandler, type ContestCalendarWindow } from './handler.ts'

const CLIST_API_URL = 'https://clist.by'
const MAX_RESPONSE_BYTES = 2_000_000
const REQUEST_TIMEOUT_MS = 12_000

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function apiUrl(window: ContestCalendarWindow): string {
  const url = new URL(CLIST_API_URL)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v4/contest/`
  url.searchParams.set('start__lt', window.endAt.toISOString())
  url.searchParams.set('end__gt', window.startAt.toISOString())
  url.searchParams.set('limit', '200')
  url.searchParams.set('order_by', 'start')
  return url.toString()
}

async function fetchCalendarApi(_url: string, window: ContestCalendarWindow): Promise<unknown> {
  const username = requiredEnv('CLIST_API_USERNAME')
  const apiKey = requiredEnv('CLIST_API_KEY')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = new URL(apiUrl(window))
    url.searchParams.set('username', username)
    url.searchParams.set('api_key', apiKey)
    const result = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'USTSACMLand contest calendar/1.0',
      },
      signal: controller.signal,
    })
    if (!result.ok) throw new Error(`clist api returned ${result.status}`)
    const bytes = new Uint8Array(await result.arrayBuffer())
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('clist api response too large')
    return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
  } finally {
    clearTimeout(timeout)
  }
}

const handler = createContestCalendarHandler({ fetchCalendarApi })
Deno.serve(handler)
