import { DOMParser } from 'deno-dom'
import { fetchJson, fetchWithRetry, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface NowcoderRatingHistoryEntry {
  rating?: unknown
  time?: unknown
}

interface NowcoderRatingHistoryResponse {
  code?: unknown
  msg?: unknown
  data?: unknown
}

interface FirecrawlJavascriptReturn {
  type?: unknown
  value?: unknown
}

interface FirecrawlScrapeResponse {
  success?: unknown
  data?: {
    actions?: {
      javascriptReturns?: unknown
    }
  }
}

interface FirecrawlNowcoderValue {
  uid?: unknown
  isProfile?: unknown
  currentRating?: unknown
  maxRating?: unknown
  solvedCount?: unknown
  ratingPoints?: unknown
}

export interface NowcoderPracticePage {
  html: string
  finalUrl: string
}

export interface NowcoderRatingMetrics {
  currentRating: number | null
  maxRating: number | null
  ratedContestCount: number
  lastRatedAt: string | null
}

export interface NowcoderSourceMetrics {
  currentRating: number | null
  maxRating: number | null
  solvedCount: number
  ratedContestCount: number
  lastRatedAt: string | null
  sourceVersion: string
  provider: 'direct' | 'firecrawl'
}

export interface NowcoderMetricsProvider {
  fetchMetrics(accountId: string, signal?: AbortSignal): Promise<NowcoderSourceMetrics>
}

export interface NowcoderAdapterOptions {
  primary?: NowcoderMetricsProvider
  fallback?: NowcoderMetricsProvider | null
  useEnvironmentFallback?: boolean
}

const ORIGIN = 'https://ac.nowcoder.com'
const USER_AGENT = 'USTSACMLand/1.0 (Nowcoder statistics sync)'
const FIRECRAWL_DEFAULT_URL = 'https://api.firecrawl.dev'
const FIRECRAWL_CACHE_MS = 12 * 60 * 60 * 1_000
const FALLBACK_ERROR_CODES = new Set([
  'rate_limited',
  'schema_changed',
  'source_unavailable',
  'timeout',
])

const FIRECRAWL_ACTION_SCRIPT = String.raw`(async () => {
  const uid = location.pathname.match(/profile\/(\d+)/)?.[1] || null;
  const isProfile = /^\/acm\/contest\/profile\/\d+\/?$/.test(location.pathname)
    && !!document.querySelector('.coder-name')
    && !!document.querySelector('.profile-status-box');
  if (!isProfile || !uid) {
    return { uid, isProfile: false, currentRating: null, maxRating: null, solvedCount: null, ratingPoints: 0 };
  }
  const ratingText = document.querySelector('.profile-status-box .state-num')?.textContent?.trim() || null;
  const chartElement = document.querySelector('.js-rating-chart');
  const chart = window.echarts && chartElement ? window.echarts.getInstanceByDom(chartElement) : null;
  const ratings = chart
    ? (chart.getOption().series?.[0]?.data || [])
      .map((point) => Number(typeof point === 'object' ? point.value : point))
      .filter(Number.isFinite)
    : [];
  const practiceHtml = await fetch(
    '/acm/contest/profile/' + uid + '/practice-coding?pageSize=200&statusTypeFilter=5&languageCategoryFilter=-1&orderType=DESC&page=1',
    { credentials: 'include' },
  ).then((response) => response.text());
  const practiceDocument = new DOMParser().parseFromString(practiceHtml, 'text/html');
  const solvedItem = [...practiceDocument.querySelectorAll('.my-state-item')]
    .find((element) => element.textContent?.includes('题已通过'));
  const solvedText = solvedItem?.querySelector('.state-num')?.textContent?.trim() || null;
  return {
    uid,
    isProfile: true,
    currentRating: ratings.length && ratingText && /^\d+$/.test(ratingText) ? Number(ratingText) : null,
    maxRating: ratings.length ? Math.max(...ratings) : null,
    solvedCount: solvedText && /^\d+$/.test(solvedText) ? Number(solvedText) : null,
    ratingPoints: ratings.length,
  };
})()`

function parseNonNegativeInteger(value: string): number | null {
  const normalized = value.replace(/[\s,]/g, '')
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isNullableRating(value: unknown): value is number | null {
  return value === null || isNonNegativeSafeInteger(value)
}

function upstreamPageError(html: string): HttpError | null {
  if (
    html.includes('challenge-platform') ||
    html.includes('cf-chl-') ||
    html.includes('aliyun_waf_') ||
    /<title>\s*Just a moment/i.test(html)
  ) {
    return new HttpError('Nowcoder returned an anti-bot challenge page', 'source_unavailable', true)
  }
  return null
}

export function parseNowcoderPracticePage(page: NowcoderPracticePage, accountId: string): number {
  let finalUrl: URL
  try {
    finalUrl = new URL(page.finalUrl)
  } catch {
    throw new HttpError('Nowcoder returned an invalid final URL', 'schema_changed', false)
  }

  const expectedPath = `/acm/contest/profile/${accountId}/practice-coding`
  if (finalUrl.origin !== ORIGIN) {
    throw new HttpError(
      'Nowcoder redirected away from the public profile',
      'source_unavailable',
      true,
    )
  }
  if (finalUrl.pathname === '/') {
    throw new HttpError('Nowcoder user was not found', 'not_found', false)
  }
  if (finalUrl.pathname.replace(/\/+$/, '') !== expectedPath) {
    throw new HttpError('Nowcoder profile redirect was not recognized', 'source_unavailable', true)
  }

  const challenge = upstreamPageError(page.html)
  if (challenge) throw challenge

  const document = new DOMParser().parseFromString(page.html, 'text/html')
  if (!document) {
    throw new HttpError('Nowcoder profile HTML could not be parsed', 'schema_changed', false)
  }
  if (document.querySelector('div.null') || document.title.includes('用户不存在')) {
    throw new HttpError('Nowcoder user was not found', 'not_found', false)
  }
  if (!document.querySelector('.profile-status-box')) {
    throw new HttpError('Nowcoder profile summary is missing', 'schema_changed', false)
  }

  for (const item of document.querySelectorAll('.my-state-item')) {
    if (item.querySelector('span')?.textContent.trim() !== '题已通过') continue
    const count = parseNonNegativeInteger(item.querySelector('.state-num')?.textContent ?? '')
    if (count === null) {
      throw new HttpError('Nowcoder solved count is invalid', 'schema_changed', false)
    }
    return count
  }

  throw new HttpError('Nowcoder solved count is missing', 'schema_changed', false)
}

export function parseNowcoderRatingHistory(payload: unknown): NowcoderRatingMetrics {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError('Nowcoder rating response is not an object', 'schema_changed', false)
  }

  const response = payload as NowcoderRatingHistoryResponse
  if (response.code !== 0 || response.msg !== 'OK') {
    const message =
      typeof response.msg === 'string' ? response.msg : 'Nowcoder API rejected the request'
    const rateLimited = /频繁|rate|too many/i.test(message)
    throw new HttpError(message, rateLimited ? 'rate_limited' : 'source_unavailable', true)
  }
  if (!Array.isArray(response.data)) {
    throw new HttpError('Nowcoder rating history is not an array', 'schema_changed', false)
  }

  const entries = response.data.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new HttpError(
        `Nowcoder rating entry ${index} is not an object`,
        'schema_changed',
        false,
      )
    }
    const entry = value as NowcoderRatingHistoryEntry
    if (
      !isNonNegativeSafeInteger(entry.rating) ||
      typeof entry.time !== 'number' ||
      !Number.isSafeInteger(entry.time) ||
      entry.time <= 0
    ) {
      throw new HttpError(
        `Nowcoder rating entry ${index} has invalid fields`,
        'schema_changed',
        false,
      )
    }
    return { rating: entry.rating, time: entry.time }
  })

  if (entries.length === 0) {
    return {
      currentRating: null,
      maxRating: null,
      ratedContestCount: 0,
      lastRatedAt: null,
    }
  }

  entries.sort((left, right) => left.time - right.time)
  const latest = entries.at(-1)!
  return {
    currentRating: latest.rating,
    maxRating: Math.max(...entries.map((entry) => entry.rating)),
    ratedContestCount: entries.length,
    lastRatedAt: new Date(latest.time).toISOString(),
  }
}

export function parseFirecrawlNowcoderMetrics(
  payload: unknown,
  accountId: string,
): NowcoderSourceMetrics {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError('Firecrawl response is not an object', 'schema_changed', false)
  }
  const response = payload as FirecrawlScrapeResponse
  if (response.success !== true || !response.data) {
    throw new HttpError('Firecrawl scrape was not successful', 'source_unavailable', true)
  }
  const returns = response.data.actions?.javascriptReturns
  if (!Array.isArray(returns) || returns.length !== 1) {
    throw new HttpError('Firecrawl action result is missing', 'schema_changed', false)
  }
  const action = returns[0] as FirecrawlJavascriptReturn
  if (action.type !== 'object' || !action.value || typeof action.value !== 'object') {
    throw new HttpError('Firecrawl action result is invalid', 'schema_changed', false)
  }

  const value = action.value as FirecrawlNowcoderValue
  if (value.isProfile === false) {
    throw new HttpError('Nowcoder user was not found', 'not_found', false)
  }
  if (value.isProfile !== true || value.uid !== accountId) {
    throw new HttpError('Firecrawl returned the wrong Nowcoder profile', 'schema_changed', false)
  }
  if (
    !isNullableRating(value.currentRating) ||
    !isNullableRating(value.maxRating) ||
    !isNonNegativeSafeInteger(value.solvedCount) ||
    !isNonNegativeSafeInteger(value.ratingPoints)
  ) {
    throw new HttpError('Firecrawl returned invalid Nowcoder metrics', 'schema_changed', false)
  }
  if (
    (value.currentRating === null) !== (value.maxRating === null) ||
    (value.ratingPoints === 0) !== (value.currentRating === null) ||
    (value.currentRating !== null && value.maxRating! < value.currentRating)
  ) {
    throw new HttpError('Firecrawl returned inconsistent Nowcoder ratings', 'schema_changed', false)
  }

  return {
    currentRating: value.currentRating,
    maxRating: value.maxRating,
    solvedCount: value.solvedCount,
    ratedContestCount: value.ratingPoints,
    lastRatedAt: null,
    sourceVersion: 'nowcoder-firecrawl-profile-v1',
    provider: 'firecrawl',
  }
}

export const directNowcoderProvider: NowcoderMetricsProvider = {
  async fetchMetrics(accountId, signal) {
    const response = await fetchWithRetry(
      `${ORIGIN}/acm/contest/profile/${encodeURIComponent(accountId)}/practice-coding?pageSize=1&statusTypeFilter=5&page=1`,
      {
        signal,
        timeoutMs: 15_000,
        retries: 2,
        retryBaseMs: 750,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
          'user-agent': USER_AGENT,
        },
      },
    )
    const solvedCount = parseNowcoderPracticePage(
      { html: await response.text(), finalUrl: response.url },
      accountId,
    )
    const rating = parseNowcoderRatingHistory(
      await fetchJson<unknown>(
        `${ORIGIN}/acm/contest/rating-history?uid=${encodeURIComponent(accountId)}`,
        {
          signal,
          timeoutMs: 12_000,
          retries: 2,
          retryBaseMs: 750,
          headers: {
            accept: 'application/json,text/plain,*/*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
            'user-agent': USER_AGENT,
          },
        },
      ),
    )

    return {
      currentRating: rating.currentRating,
      maxRating: rating.maxRating,
      solvedCount,
      ratedContestCount: rating.ratedContestCount,
      lastRatedAt: rating.lastRatedAt,
      sourceVersion: 'nowcoder-rating-history-practice-v1',
      provider: 'direct',
    }
  },
}

export function createFirecrawlNowcoderProvider(
  apiKey: string,
  apiUrl = FIRECRAWL_DEFAULT_URL,
): NowcoderMetricsProvider {
  const endpoint = `${apiUrl.replace(/\/+$/, '')}/v2/scrape`
  return {
    async fetchMetrics(accountId, signal) {
      try {
        return parseFirecrawlNowcoderMetrics(
          await fetchJson<unknown>(endpoint, {
            method: 'POST',
            signal,
            timeoutMs: 70_000,
            retries: 1,
            retryBaseMs: 1_500,
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              url: `${ORIGIN}/acm/contest/profile/${encodeURIComponent(accountId)}`,
              formats: ['html'],
              actions: [
                { type: 'wait', milliseconds: 5_000 },
                { type: 'executeJavascript', script: FIRECRAWL_ACTION_SCRIPT },
              ],
              timeout: 60_000,
              proxy: 'auto',
              maxAge: FIRECRAWL_CACHE_MS,
              storeInCache: true,
            }),
          }),
          accountId,
        )
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          throw new HttpError(
            'Firecrawl API key is invalid or expired',
            'auth_expired',
            false,
            401,
            undefined,
            { authTarget: 'firecrawl' },
          )
        }
        if (error instanceof HttpError && error.status === 403) {
          throw new HttpError(
            'Firecrawl API access is forbidden',
            'auth_required',
            false,
            403,
            undefined,
            { authTarget: 'firecrawl' },
          )
        }
        throw error
      }
    },
  }
}

function environmentFirecrawlProvider(): NowcoderMetricsProvider | null {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY')?.trim()
  if (!apiKey) return null
  const apiUrl = Deno.env.get('FIRECRAWL_API_URL')?.trim() || FIRECRAWL_DEFAULT_URL
  return createFirecrawlNowcoderProvider(apiKey, apiUrl)
}

function resultSuccess(accountId: string, metrics: NowcoderSourceMetrics): AdapterResult {
  return success(
    'nowcoder',
    accountId,
    {
      currentRating: metrics.currentRating,
      maxRating: metrics.maxRating,
      solvedCount: metrics.solvedCount,
    },
    {
      sourceUpdatedAt: null,
      sourceVersion: metrics.sourceVersion,
      details: {
        provider: metrics.provider,
        ratedContestCount: metrics.ratedContestCount,
        lastRatedAt: metrics.lastRatedAt,
      },
    },
  )
}

export function createNowcoderAdapter(options: NowcoderAdapterOptions = {}): PlatformAdapter {
  const primary = options.primary ?? directNowcoderProvider
  return {
    platform: 'nowcoder',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      if (!/^\d{1,20}$/.test(accountId)) {
        return failure(
          'nowcoder',
          accountId,
          'invalid_account',
          'Invalid Nowcoder UID format',
          false,
        )
      }

      try {
        return resultSuccess(accountId, await primary.fetchMetrics(accountId, context?.signal))
      } catch (primaryError) {
        const primaryFailure = toAdapterHttpError(primaryError)
        const fallback =
          options.fallback === undefined && options.useEnvironmentFallback
            ? environmentFirecrawlProvider()
            : options.fallback
        if (!fallback || !FALLBACK_ERROR_CODES.has(primaryFailure.code)) {
          return failure(
            'nowcoder',
            accountId,
            primaryFailure.code,
            primaryFailure.message,
            primaryFailure.retryable,
            {
              ...primaryFailure.details,
              firecrawlFallbackConfigured: Boolean(fallback),
            },
          )
        }

        try {
          return resultSuccess(accountId, await fallback.fetchMetrics(accountId, context?.signal))
        } catch (fallbackError) {
          const fallbackFailure = toAdapterHttpError(fallbackError)
          return failure(
            'nowcoder',
            accountId,
            fallbackFailure.code,
            fallbackFailure.message,
            fallbackFailure.retryable,
            {
              ...fallbackFailure.details,
              primaryErrorCode: primaryFailure.code,
            },
          )
        }
      }
    },
  }
}

export const nowcoderAdapter = createNowcoderAdapter({ useEnvironmentFallback: true })
