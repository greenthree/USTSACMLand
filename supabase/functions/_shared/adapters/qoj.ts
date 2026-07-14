import { fetchJson, type FetchWithRetryOptions, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

interface FirecrawlScrapeResponse {
  success?: unknown
  data?: {
    metadata?: {
      scrapeId?: unknown
    }
  }
}

interface FirecrawlInteractResponse {
  success?: unknown
  stdout?: unknown
  result?: unknown
  exitCode?: unknown
  killed?: unknown
}

interface FirecrawlQojValue {
  pathname?: unknown
  profileUsername?: unknown
  isLogin?: unknown
  hasLogout?: unknown
  loginFailure?: unknown
  notFound?: unknown
  challenge?: unknown
  rateLimited?: unknown
  fetchFailed?: unknown
  failureStage?: unknown
  responseStatus?: unknown
  navigationError?: unknown
  acceptedCount?: unknown
}

export interface QojMetricsProvider {
  fetchAcceptedCount(accountId: string, signal?: AbortSignal): Promise<number>
}

export interface QojAdapterOptions {
  provider?: QojMetricsProvider | null
  useEnvironmentProvider?: boolean
}

type QojJsonFetcher = (input: string, options: FetchWithRetryOptions) => Promise<unknown>

const ORIGIN = 'https://qoj.ac'
const FIRECRAWL_DEFAULT_URL = 'https://api.firecrawl.dev'
const QOJ_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/
const QOJ_SERVICE_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,25}$/
const QOJ_SERVICE_PASSWORD_PATTERN = /^[!-~]{6,20}$/
const QOJ_RESULT_PREFIX = 'QOJ_RESULT:'
const FIRECRAWL_JOB_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function qojInteractCode(
  accountId: string,
  serviceUsername: string,
  servicePassword: string,
): string {
  const targetUrl = `${ORIGIN}/user/profile/${encodeURIComponent(accountId)}?locale=en`
  return String.raw`const inspect = async (
    responseStatus = null,
    failureStage = null,
    navigationError = null,
  ) => {
    const pathname = new URL(page.url()).pathname.replace(/\/+$/, '') || '/';
    const profileMatch = pathname.match(/^\/user\/profile\/([^/]+)$/);
    let profileUsername = null;
    if (profileMatch) {
      try {
        profileUsername = decodeURIComponent(profileMatch[1]);
      } catch {
        profileUsername = null;
      }
    }
    const linkTexts = await page.locator('a').allTextContents();
    const hasLogout = linkTexts.some((text) => text.trim().toLowerCase() === 'logout');
    const isLogin = pathname === '/login'
      || await page.locator('#form-login, #input-password').count() > 0;
    const pageText = await page.locator('body').innerText().catch(() => '');
    const loginHelp = (await page.locator('#form-login .help-block').allTextContents())
      .map((text) => text.trim())
      .filter(Boolean)
      .join(' ');
    const loginFailure = !loginHelp ? null
      : /incorrect username or password/i.test(loginHelp) ? 'credentials_rejected'
      : /session has expired/i.test(loginHelp) ? 'session_expired'
      : /security reasons/i.test(loginHelp) ? 'security_rejected'
      : /two-factor authentication is required|nextgeneration.*verification system/i.test(loginHelp)
        ? 'two_factor'
      : /no permissions/i.test(loginHelp) ? 'account_disabled'
      : 'rejected';
    const notFound = /\b(?:user|profile)\s+(?:does not exist|not found)\b/i.test(pageText)
      || /\b404\s+(?:Not Found|Page Not Found)\b/i.test(pageText);
    const challenge = /\bJust a moment\b|\bChecking your browser\b/i.test(pageText)
      || await page.locator('#challenge-form, .challenge-platform, [class*="cf-chl-"]').count() > 0;
    const heading = (await page.locator('h1,h2,h3,h4,h5,h6').allTextContents())
      .map((text) => text.trim())
      .find((text) => /^Accepted\s+problems\s*[:：]/i.test(text)) || '';
    const countMatch = heading.match(/^Accepted\s+problems\s*[:：]\s*([\d,]+)\s+problems?\b/i);
    const acceptedCount = countMatch ? Number(countMatch[1].replaceAll(',', '')) : null;
    return {
      pathname,
      profileUsername,
      isLogin,
      hasLogout,
      loginFailure,
      notFound,
      challenge,
      rateLimited: responseStatus === 429,
      fetchFailed: typeof responseStatus === 'number'
        && responseStatus >= 400
        && responseStatus !== 404
        && responseStatus !== 429,
      failureStage,
      responseStatus,
      navigationError,
      acceptedCount,
    };
  };

  try {
    await page.locator('#form-login #input-username').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#form-login #input-username').fill(${JSON.stringify(serviceUsername)});
    await page.locator('#form-login #input-password').fill(${JSON.stringify(servicePassword)});
    await page.locator('#form-login #button-submit').click();

    const loginDeadline = Date.now() + 15_000;
    let loginState = await inspect();
    while (
      !loginState.challenge
      && !loginState.loginFailure
      && (loginState.isLogin || !loginState.hasLogout)
      && Date.now() < loginDeadline
    ) {
      await page.waitForTimeout(250);
      loginState = await inspect();
    }

    if (loginState.challenge || loginState.isLogin || !loginState.hasLogout) {
      process.stdout.write(${JSON.stringify(QOJ_RESULT_PREFIX)} + JSON.stringify(loginState) + '\n');
    } else {
      try {
        const response = await page.goto(${JSON.stringify(targetUrl)}, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForTimeout(500);
        const profileState = await inspect(response ? response.status() : null);
        process.stdout.write(${JSON.stringify(QOJ_RESULT_PREFIX)} + JSON.stringify(profileState) + '\n');
      } catch (error) {
        const navigationError = error instanceof Error
          ? (error.name + ': ' + error.message).slice(0, 500)
          : 'Unknown navigation error';
        process.stdout.write(${JSON.stringify(QOJ_RESULT_PREFIX)} + JSON.stringify({
          ...loginState,
          rateLimited: false,
          fetchFailed: true,
          failureStage: 'profile_navigation',
          responseStatus: null,
          navigationError,
        }) + '\n');
      }
    }
  } catch (error) {
    const navigationError = error instanceof Error
      ? (error.name + ': ' + error.message).slice(0, 500)
      : 'Unknown login-form error';
    process.stdout.write(${JSON.stringify(QOJ_RESULT_PREFIX)} + JSON.stringify({
      pathname: new URL(page.url()).pathname.replace(/\/+$/, '') || '/',
      profileUsername: null,
      isLogin: true,
      hasLogout: false,
      loginFailure: null,
      notFound: false,
      challenge: false,
      rateLimited: false,
      fetchFailed: true,
      failureStage: 'login_form',
      responseStatus: null,
      navigationError,
      acceptedCount: null,
    }) + '\n');
  }
`
}

function parseFirecrawlSessionId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError('Firecrawl response is not an object', 'schema_changed', false)
  }

  const response = payload as FirecrawlScrapeResponse
  if (response.success !== true || !response.data) {
    throw new HttpError('Firecrawl session could not be created', 'source_unavailable', true)
  }
  const jobId = response.data.metadata?.scrapeId
  if (typeof jobId !== 'string' || !FIRECRAWL_JOB_ID_PATTERN.test(jobId)) {
    throw new HttpError('Firecrawl session id is missing', 'schema_changed', false)
  }
  return jobId
}

export function parseFirecrawlQojAcceptedCount(payload: unknown, accountId: string): number {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError('Firecrawl interact response is not an object', 'schema_changed', false)
  }

  const response = payload as FirecrawlInteractResponse
  if (response.success !== true) {
    throw new HttpError(
      response.killed === true
        ? 'Firecrawl interact execution was killed'
        : 'Firecrawl interact was not successful',
      'source_unavailable',
      true,
      undefined,
      undefined,
      { interactKilled: response.killed === true },
    )
  }
  if (response.exitCode !== undefined && response.exitCode !== null && response.exitCode !== 0) {
    throw new HttpError(
      `Firecrawl interact execution failed with exit code ${String(response.exitCode)}`,
      'source_unavailable',
      true,
      undefined,
      undefined,
      { interactExitCode: response.exitCode },
    )
  }

  const output = [response.stdout, response.result].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.includes(QOJ_RESULT_PREFIX),
  )
  const resultLine = output
    ?.split(/\r?\n/)
    .reverse()
    .find((line) => line.includes(QOJ_RESULT_PREFIX))
  if (!resultLine) {
    throw new HttpError('Firecrawl QOJ interact result is missing', 'schema_changed', false)
  }

  let value: FirecrawlQojValue
  try {
    const markerIndex = resultLine.indexOf(QOJ_RESULT_PREFIX)
    value = JSON.parse(
      resultLine.slice(markerIndex + QOJ_RESULT_PREFIX.length),
    ) as FirecrawlQojValue
  } catch {
    throw new HttpError('Firecrawl QOJ interact result is invalid', 'schema_changed', false)
  }

  const allowedLoginFailures = new Set([
    'credentials_rejected',
    'session_expired',
    'security_rejected',
    'two_factor',
    'account_disabled',
    'rejected',
  ])
  const allowedFailureStages = new Set(['login_form', 'profile_navigation'])
  if (
    typeof value.pathname !== 'string' ||
    typeof value.isLogin !== 'boolean' ||
    typeof value.hasLogout !== 'boolean' ||
    (value.loginFailure !== null &&
      (typeof value.loginFailure !== 'string' || !allowedLoginFailures.has(value.loginFailure))) ||
    typeof value.notFound !== 'boolean' ||
    typeof value.challenge !== 'boolean' ||
    typeof value.rateLimited !== 'boolean' ||
    typeof value.fetchFailed !== 'boolean' ||
    (value.failureStage !== null &&
      (typeof value.failureStage !== 'string' || !allowedFailureStages.has(value.failureStage))) ||
    (value.responseStatus !== null && typeof value.responseStatus !== 'number') ||
    (value.navigationError !== null && typeof value.navigationError !== 'string')
  ) {
    throw new HttpError('Firecrawl returned invalid QOJ page state', 'schema_changed', false)
  }

  if (value.challenge) {
    throw new HttpError('QOJ returned an anti-bot challenge page', 'source_unavailable', true)
  }
  if (value.rateLimited) {
    throw new HttpError('QOJ rate limit was reached', 'rate_limited', true)
  }
  if (value.fetchFailed) {
    const navigationError =
      typeof value.navigationError === 'string' ? value.navigationError.slice(0, 500) : null
    const responseStatus =
      typeof value.responseStatus === 'number' ? value.responseStatus : undefined
    const timedOut = navigationError !== null && /timeout/i.test(navigationError)
    const message =
      value.failureStage === 'login_form'
        ? `QOJ login form could not be loaded${navigationError ? `: ${navigationError}` : ''}`
        : responseStatus !== undefined
          ? `QOJ profile returned HTTP ${responseStatus}`
          : `QOJ profile navigation failed${navigationError ? `: ${navigationError}` : ''}`
    throw new HttpError(
      message,
      timedOut ? 'timeout' : 'source_unavailable',
      true,
      responseStatus,
      undefined,
      {
        failureStage: value.failureStage,
        responseStatus: responseStatus ?? null,
        navigationError,
      },
    )
  }
  if (value.isLogin || value.pathname === '/login' || !value.hasLogout) {
    if (value.loginFailure === 'session_expired') {
      throw new HttpError('QOJ login page session expired', 'source_unavailable', true)
    }
    if (value.loginFailure === 'security_rejected') {
      throw new HttpError('QOJ rejected the automated login request', 'source_unavailable', false)
    }
    if (value.loginFailure === 'two_factor') {
      throw new HttpError(
        'QOJ service account requires two-factor authentication',
        'auth_required',
        false,
      )
    }
    if (value.loginFailure === 'account_disabled') {
      throw new HttpError('QOJ service account is disabled', 'auth_required', false)
    }
    if (value.loginFailure === 'credentials_rejected') {
      throw new HttpError('QOJ rejected the service-account credentials', 'auth_expired', false)
    }
    throw new HttpError('QOJ service-account login failed', 'auth_expired', false)
  }

  if (value.notFound) {
    throw new HttpError('QOJ user was not found', 'not_found', false)
  }
  const expectedPath = `/user/profile/${encodeURIComponent(accountId)}`
  if (value.pathname !== expectedPath || value.profileUsername !== accountId) {
    throw new HttpError('Firecrawl returned the wrong QOJ profile', 'schema_changed', false)
  }
  if (!Number.isSafeInteger(value.acceptedCount) || (value.acceptedCount as number) < 0) {
    throw new HttpError('QOJ accepted problem count is missing', 'schema_changed', false)
  }
  return value.acceptedCount as number
}

export function createFirecrawlQojProvider(
  apiKey: string,
  serviceUsername: string,
  servicePassword: string,
  apiUrl = FIRECRAWL_DEFAULT_URL,
  fetcher: QojJsonFetcher = (input, options) => fetchJson<unknown>(input, options),
): QojMetricsProvider {
  const normalizedApiKey = apiKey.trim()
  const normalizedUsername = serviceUsername.trim()
  if (!normalizedApiKey) {
    throw new HttpError('Firecrawl API key is not configured', 'auth_required', false)
  }
  if (!QOJ_SERVICE_USERNAME_PATTERN.test(normalizedUsername)) {
    throw new HttpError('QOJ service-account username is invalid', 'auth_required', false)
  }
  if (!QOJ_SERVICE_PASSWORD_PATTERN.test(servicePassword)) {
    throw new HttpError('QOJ service-account password is not configured', 'auth_required', false)
  }

  const endpoint = `${apiUrl.replace(/\/+$/, '')}/v2/scrape`
  const requestHeaders = {
    accept: 'application/json',
    authorization: `Bearer ${normalizedApiKey}`,
    'content-type': 'application/json',
  }
  return {
    async fetchAcceptedCount(accountId, signal) {
      let jobId: string | null = null
      try {
        const sessionPayload = await fetcher(endpoint, {
          method: 'POST',
          signal,
          timeoutMs: 45_000,
          retries: 0,
          retryBaseMs: 1_500,
          headers: requestHeaders,
          body: JSON.stringify({
            url: `${ORIGIN}/login?locale=en`,
            formats: ['html'],
            onlyMainContent: false,
            timeout: 35_000,
            proxy: 'auto',
            maxAge: 0,
            storeInCache: false,
          }),
        })
        jobId = parseFirecrawlSessionId(sessionPayload)

        const interactPayload = await fetcher(`${endpoint}/${encodeURIComponent(jobId)}/interact`, {
          method: 'POST',
          signal,
          timeoutMs: 110_000,
          retries: 0,
          retryBaseMs: 1_500,
          headers: requestHeaders,
          body: JSON.stringify({
            code: qojInteractCode(accountId, normalizedUsername, servicePassword),
            language: 'node',
            timeout: 90,
          }),
        })
        return parseFirecrawlQojAcceptedCount(interactPayload, accountId)
      } catch (error) {
        const diagnostics = {
          ...(error instanceof HttpError ? (error.details ?? {}) : {}),
          ...(jobId ? { firecrawlJobId: jobId } : {}),
        }
        if (error instanceof HttpError && error.status === 401) {
          throw new HttpError(
            'Firecrawl API key is invalid or expired',
            'auth_expired',
            false,
            401,
            undefined,
            diagnostics,
          )
        }
        if (error instanceof HttpError && error.status === 403) {
          throw new HttpError(
            'Firecrawl API access is forbidden',
            'auth_required',
            false,
            403,
            undefined,
            diagnostics,
          )
        }
        if (error instanceof HttpError && error.status === 409) {
          throw new HttpError(
            'Firecrawl QOJ browser session is busy',
            'rate_limited',
            true,
            409,
            undefined,
            diagnostics,
          )
        }
        if (error instanceof HttpError && error.status === 404) {
          throw new HttpError(
            'Firecrawl QOJ browser session was not found',
            'source_unavailable',
            true,
            404,
            undefined,
            diagnostics,
          )
        }
        if (error instanceof HttpError && jobId) {
          throw new HttpError(
            error.message,
            error.code,
            error.retryable,
            error.status,
            error.responseBody,
            diagnostics,
          )
        }
        throw error
      } finally {
        if (jobId) {
          await fetcher(`${endpoint}/${encodeURIComponent(jobId)}/interact`, {
            method: 'DELETE',
            timeoutMs: 15_000,
            retries: 0,
            headers: requestHeaders,
          }).catch(() => undefined)
        }
      }
    },
  }
}

function environmentQojProvider(): QojMetricsProvider | null {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY')?.trim()
  const serviceUsername = Deno.env.get('QOJ_SERVICE_USERNAME')?.trim()
  const servicePassword = Deno.env.get('QOJ_SERVICE_PASSWORD')
  if (!apiKey || !serviceUsername || !servicePassword) return null
  const apiUrl = Deno.env.get('FIRECRAWL_API_URL')?.trim() || FIRECRAWL_DEFAULT_URL
  return createFirecrawlQojProvider(apiKey, serviceUsername, servicePassword, apiUrl)
}

export function createQojAdapter(options: QojAdapterOptions = {}): PlatformAdapter {
  return {
    platform: 'qoj',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      if (!QOJ_USERNAME_PATTERN.test(accountId)) {
        return failure('qoj', accountId, 'invalid_account', 'Invalid QOJ username format', false)
      }

      try {
        const provider =
          options.provider === undefined && options.useEnvironmentProvider
            ? environmentQojProvider()
            : options.provider
        if (!provider) {
          return failure(
            'qoj',
            accountId,
            'auth_required',
            'QOJ service-account login is not configured',
            false,
            {
              requiredSecrets: [
                'FIRECRAWL_API_KEY',
                'QOJ_SERVICE_USERNAME',
                'QOJ_SERVICE_PASSWORD',
              ],
            },
          )
        }

        const solvedCount = await provider.fetchAcceptedCount(accountId, context?.signal)
        return success(
          'qoj',
          accountId,
          { currentRating: null, maxRating: null, solvedCount },
          {
            sourceUpdatedAt: null,
            sourceVersion: 'qoj-firecrawl-interact-v1',
            details: { provider: 'firecrawl', authMode: 'per_request_interact' },
          },
        )
      } catch (error) {
        const normalized = toAdapterHttpError(error)
        return failure(
          'qoj',
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

export const qojAdapter = createQojAdapter({ useEnvironmentProvider: true })
