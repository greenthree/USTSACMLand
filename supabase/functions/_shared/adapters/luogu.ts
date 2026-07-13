import { DOMParser } from 'deno-dom'
import { fetchWithRetry, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface LuoguProfileContext {
  data?: {
    user?: {
      uid?: unknown
      passedProblemCount?: unknown
    } | null
  }
}

export interface LuoguProfilePage {
  html: string
  finalUrl: string
}

export interface LuoguTransport {
  fetchProfile(accountId: string, signal?: AbortSignal): Promise<LuoguProfilePage>
}

export interface LuoguAdapterOptions {
  transport?: LuoguTransport
}

const ORIGIN = 'https://www.luogu.com.cn'
const USER_AGENT = 'USTSACMLand/1.0'

function challengePage(body: string): boolean {
  return (
    body.includes('challenge-platform') ||
    body.includes('aliyun_waf_') ||
    body.includes('__shield') ||
    /<title>\s*Just a moment/i.test(body)
  )
}

export function parseLuoguProfilePage(page: LuoguProfilePage, accountId: string): number {
  let finalUrl: URL
  try {
    finalUrl = new URL(page.finalUrl)
  } catch {
    throw new HttpError('Luogu returned an invalid profile URL', 'schema_changed', false)
  }
  if (finalUrl.origin !== ORIGIN) {
    throw new HttpError('Luogu redirected away from the user profile', 'source_unavailable', true)
  }
  if (challengePage(page.html)) {
    throw new HttpError('Luogu returned an anti-bot challenge page', 'source_unavailable', true)
  }
  if (finalUrl.pathname.startsWith('/auth/login')) {
    throw new HttpError(
      'Luogu unexpectedly required login for a public profile',
      'source_unavailable',
      true,
    )
  }
  const normalizedPath = finalUrl.pathname.replace(/\/+$/, '')
  if (normalizedPath !== `/user/${accountId}`) {
    if (/^\/user\/\d+$/.test(normalizedPath)) {
      throw new HttpError('Luogu returned the wrong user profile', 'schema_changed', false)
    }
    throw new HttpError('Luogu user was not found', 'not_found', false)
  }

  const document = new DOMParser().parseFromString(page.html, 'text/html')
  const contextElement = document?.querySelector('#lentille-context')
  if (!document || !contextElement) {
    throw new HttpError('Luogu profile context is missing', 'schema_changed', false)
  }

  let contextText = contextElement.textContent.trim()
  try {
    if (contextText.startsWith('%7B') || contextText.startsWith('%7b')) {
      contextText = decodeURIComponent(contextText)
    }
    const context = JSON.parse(contextText) as LuoguProfileContext
    const user = context.data?.user
    if (user === null) {
      throw new HttpError('Luogu user was not found', 'not_found', false)
    }
    const returnedUid = user?.uid
    if (returnedUid === undefined || returnedUid === null) {
      throw new HttpError('Luogu profile UID is missing', 'schema_changed', false)
    }
    if (String(returnedUid) !== accountId) {
      throw new HttpError('Luogu returned the wrong user profile', 'schema_changed', false)
    }
    if (
      typeof user?.passedProblemCount !== 'number' ||
      !Number.isSafeInteger(user.passedProblemCount) ||
      user.passedProblemCount < 0
    ) {
      throw new HttpError('Luogu profile passed problem count is invalid', 'schema_changed', false)
    }
    return user.passedProblemCount
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('Luogu profile context is invalid', 'schema_changed', false)
  }
}

function publicTransport(): LuoguTransport {
  return {
    async fetchProfile(accountId, signal) {
      const response = await fetchWithRetry(`${ORIGIN}/user/${encodeURIComponent(accountId)}`, {
        signal,
        timeoutMs: 15_000,
        retries: 2,
        retryBaseMs: 750,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          referer: `${ORIGIN}/`,
          'user-agent': USER_AGENT,
        },
      })
      return { html: await response.text(), finalUrl: response.url }
    },
  }
}

function normalizeLuoguError(error: unknown): ReturnType<typeof toAdapterHttpError> {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return {
      code: 'source_unavailable',
      message: 'Luogu blocked the public profile request',
      retryable: true,
      details: { httpStatus: error.status },
    }
  }
  return toAdapterHttpError(error)
}

export function createLuoguAdapter(options: LuoguAdapterOptions = {}): PlatformAdapter {
  return {
    platform: 'luogu',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      if (!/^\d{1,20}$/.test(accountId)) {
        return failure('luogu', accountId, 'invalid_account', 'Invalid Luogu UID format', false)
      }

      try {
        const solvedCount = parseLuoguProfilePage(
          await (options.transport ?? publicTransport()).fetchProfile(accountId, context?.signal),
          accountId,
        )
        return success(
          'luogu',
          accountId,
          { currentRating: null, maxRating: null, solvedCount },
          {
            sourceUpdatedAt: null,
            sourceVersion: 'luogu-public-profile-v1',
            details: { statistic: 'data.user.passedProblemCount' },
          },
        )
      } catch (error) {
        const normalized = normalizeLuoguError(error)
        return failure(
          'luogu',
          accountId,
          normalized.code,
          normalized.message,
          normalized.retryable,
          normalized.details,
        )
      }
    },
  }
}

export const luoguAdapter = createLuoguAdapter()
