import { deepStrictEqual, equal, rejects, throws } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import {
  createFirecrawlQojProvider,
  createQojAdapter,
  parseFirecrawlQojAcceptedCount,
  type QojMetricsProvider,
} from './qoj.ts'

interface QojTestState {
  pathname: string
  profileUsername: string | null
  isLogin: boolean
  hasLogout: boolean
  loginFailure: string | null
  notFound: boolean
  challenge: boolean
  rateLimited: boolean
  fetchFailed: boolean
  acceptedCount: number | null
}

const JOB_ID = '019f5b0f-c8fd-7258-b025-0faa184e529d'

function interactPayload(
  accountId = 'sample_user',
  acceptedCount = 10,
  overrides: Partial<QojTestState> = {},
): { success: true; stdout: string; result: string; exitCode: number } {
  const state: QojTestState = {
    pathname: `/user/profile/${accountId}`,
    profileUsername: accountId,
    isLogin: false,
    hasLogout: true,
    loginFailure: null,
    notFound: false,
    challenge: false,
    rateLimited: false,
    fetchFailed: false,
    acceptedCount,
    ...overrides,
  }
  return {
    success: true,
    stdout: `QOJ_RESULT:${JSON.stringify(state)}`,
    result: '',
    exitCode: 0,
  }
}

Deno.test('QOJ Firecrawl parser reads the aggregate unique accepted count', () => {
  equal(parseFirecrawlQojAcceptedCount(interactPayload(), 'sample_user'), 10)
  equal(parseFirecrawlQojAcceptedCount(interactPayload('zero_user', 0), 'zero_user'), 0)

  const noisyPayload = interactPayload()
  noisyPayload.stdout = `browser ready\n${noisyPayload.stdout}\n`
  equal(parseFirecrawlQojAcceptedCount(noisyPayload, 'sample_user'), 10)
})

Deno.test('QOJ Firecrawl parser reports an incomplete per-request login', () => {
  throws(
    () =>
      parseFirecrawlQojAcceptedCount(
        interactPayload('sample_user', 0, {
          pathname: '/login',
          profileUsername: null,
          isLogin: true,
          hasLogout: false,
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) => error instanceof HttpError && error.code === 'auth_expired',
  )
})

Deno.test('QOJ Firecrawl parser distinguishes an anti-bot challenge from login failure', () => {
  throws(
    () =>
      parseFirecrawlQojAcceptedCount(
        interactPayload('sample_user', 0, {
          pathname: '/',
          profileUsername: null,
          isLogin: false,
          hasLogout: false,
          challenge: true,
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) => error instanceof HttpError && error.code === 'source_unavailable',
  )
})

Deno.test('QOJ Firecrawl parser preserves a rejected credential diagnosis', () => {
  throws(
    () =>
      parseFirecrawlQojAcceptedCount(
        interactPayload('sample_user', 0, {
          pathname: '/login',
          profileUsername: null,
          isLogin: true,
          hasLogout: false,
          loginFailure: 'credentials_rejected',
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'auth_expired' &&
      error.message === 'QOJ rejected the service-account credentials',
  )
})

Deno.test('QOJ Firecrawl parser preserves browser-side rate limits', () => {
  throws(
    () =>
      parseFirecrawlQojAcceptedCount(
        interactPayload('sample_user', 0, { rateLimited: true, acceptedCount: null }),
        'sample_user',
      ),
    (error: unknown) => error instanceof HttpError && error.code === 'rate_limited',
  )
})

Deno.test('QOJ Firecrawl parser rejects a response for another account', () => {
  throws(
    () => parseFirecrawlQojAcceptedCount(interactPayload('another_user'), 'sample_user'),
    (error: unknown) => error instanceof HttpError && error.code === 'schema_changed',
  )
})

Deno.test(
  'QOJ Firecrawl provider creates, interacts with, and stops a temporary session',
  async () => {
    const calls: Array<{ input: string; method: string; body: string }> = []
    const provider = createFirecrawlQojProvider(
      'test-api-key',
      'service_user',
      'service-pass-value',
      'https://firecrawl.example',
      (input, options) => {
        calls.push({
          input,
          method: String(options.method ?? 'GET'),
          body: String(options.body ?? ''),
        })
        if (options.method === 'DELETE') return Promise.resolve({ success: true })
        if (input.endsWith('/interact')) return Promise.resolve(interactPayload())
        return Promise.resolve({
          success: true,
          data: { metadata: { scrapeId: JOB_ID } },
        })
      },
    )

    equal(await provider.fetchAcceptedCount('sample_user'), 10)
    equal(calls.length, 3)

    const sessionBody = JSON.parse(calls[0].body) as Record<string, unknown>
    equal(calls[0].input, 'https://firecrawl.example/v2/scrape')
    equal(calls[0].method, 'POST')
    equal(sessionBody.url, 'https://qoj.ac/login?locale=en')
    equal(sessionBody.maxAge, 0)
    equal(sessionBody.storeInCache, false)
    equal('actions' in sessionBody, false)
    equal('profile' in sessionBody, false)
    equal(calls[0].body.includes('service_user'), false)
    equal(calls[0].body.includes('service-pass-value'), false)

    const interactBody = JSON.parse(calls[1].body) as Record<string, unknown>
    equal(calls[1].input, `https://firecrawl.example/v2/scrape/${JOB_ID}/interact`)
    equal(calls[1].method, 'POST')
    equal(interactBody.language, 'node')
    equal(interactBody.timeout, 90)
    const code = String(interactBody.code)
    equal(code.includes('/user/profile/sample_user?locale=en'), true)
    equal(code.includes('process.stdout.write'), true)
    equal(code.includes('console.log'), false)
    equal(code.split('service_user').length - 1, 1)
    equal(code.split('service-pass-value').length - 1, 1)

    equal(calls[2].input, `https://firecrawl.example/v2/scrape/${JOB_ID}/interact`)
    equal(calls[2].method, 'DELETE')
    equal(calls[2].body, '')
  },
)

Deno.test('QOJ Firecrawl provider rejects credentials the login form would truncate', () => {
  throws(
    () => createFirecrawlQojProvider('test-api-key', 'service_user', 'x'.repeat(21)),
    (error: unknown) => error instanceof HttpError && error.code === 'auth_required',
  )
  throws(
    () => createFirecrawlQojProvider('test-api-key', 'service_user', 'short'),
    (error: unknown) => error instanceof HttpError && error.code === 'auth_required',
  )
})

Deno.test('QOJ Firecrawl provider requires a scrape-bound browser session id', async () => {
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    () => Promise.resolve({ success: true, data: { metadata: {} } }),
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) => error instanceof HttpError && error.code === 'schema_changed',
  )
})

Deno.test('QOJ adapter returns solved metrics from the configured provider', async () => {
  const provider: QojMetricsProvider = {
    fetchAcceptedCount: () => Promise.resolve(37),
  }
  const result = await createQojAdapter({ provider }).sync(' sample_user ')

  equal(result.ok, true)
  if (!result.ok) throw new Error('Expected QOJ synchronization to succeed')
  deepStrictEqual(result.metrics, {
    currentRating: null,
    maxRating: null,
    solvedCount: 37,
  })
  equal(result.sourceVersion, 'qoj-firecrawl-interact-v1')
})

Deno.test('QOJ adapter keeps authentication errors structured', async () => {
  const provider: QojMetricsProvider = {
    fetchAcceptedCount: () =>
      Promise.reject(new HttpError('QOJ service-account login failed', 'auth_expired', false)),
  }
  const result = await createQojAdapter({ provider }).sync('sample_user')

  equal(result.ok, false)
  if (result.ok) throw new Error('Expected QOJ synchronization to fail')
  equal(result.error.code, 'auth_expired')
  equal(result.error.retryable, false)
})

Deno.test('QOJ adapter rejects invalid usernames before contacting the provider', async () => {
  let called = false
  const provider: QojMetricsProvider = {
    fetchAcceptedCount: () => {
      called = true
      return Promise.resolve(1)
    },
  }
  const result = await createQojAdapter({ provider }).sync('../invalid')

  equal(result.ok, false)
  if (result.ok) throw new Error('Expected QOJ synchronization to fail')
  equal(result.error.code, 'invalid_account')
  equal(called, false)
})
