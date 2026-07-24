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
  failureStage: 'login_navigation' | 'login_selector' | 'login_submit' | 'profile_navigation' | null
  loginSubmitStep: 'fill_username' | 'fill_password' | 'click_submit' | 'observe_result' | null
  responseStatus: number | null
  navigationError: string | null
  acceptedCount: number | null
}

const SESSION_ID = '019f5b0f-c8fd-7258-b025-0faa184e529d'

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
    failureStage: null,
    loginSubmitStep: null,
    responseStatus: null,
    navigationError: null,
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
          failureStage: 'login_submit',
          loginSubmitStep: 'observe_result',
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'source_unavailable' &&
      error.details?.failureStage === 'login_submit' &&
      error.details?.loginSubmitStep === 'observe_result',
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
          loginSubmitStep: 'observe_result',
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'auth_expired' &&
      error.message === 'QOJ rejected the service-account credentials' &&
      error.details?.failureStage === 'login_submit' &&
      error.details?.loginSubmitStep === 'observe_result',
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

Deno.test('QOJ Firecrawl parser preserves profile HTTP diagnostics', () => {
  throws(
    () =>
      parseFirecrawlQojAcceptedCount(
        interactPayload('sample_user', 0, {
          fetchFailed: true,
          failureStage: 'profile_navigation',
          responseStatus: 503,
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'source_unavailable' &&
      error.status === 503 &&
      error.message === 'QOJ profile returned HTTP 503' &&
      error.details?.failureStage === 'profile_navigation',
  )
})

Deno.test('QOJ Firecrawl parser distinguishes a navigation timeout', () => {
  throws(
    () =>
      parseFirecrawlQojAcceptedCount(
        interactPayload('sample_user', 0, {
          fetchFailed: true,
          failureStage: 'profile_navigation',
          navigationError: 'timeout',
          acceptedCount: null,
        }),
        'sample_user',
      ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'timeout' && error.message.includes('timeout'),
  )
})

Deno.test('QOJ Firecrawl parser preserves each login failure stage', () => {
  const cases = [
    ['login_navigation', 'QOJ login page navigation failed'],
    ['login_selector', 'QOJ login form controls were unavailable'],
    ['login_submit', 'QOJ login form could not be submitted'],
  ] as const

  for (const [failureStage, expectedMessage] of cases) {
    throws(
      () =>
        parseFirecrawlQojAcceptedCount(
          interactPayload('sample_user', 0, {
            pathname: '/login',
            profileUsername: null,
            isLogin: true,
            hasLogout: false,
            fetchFailed: true,
            failureStage,
            loginSubmitStep: failureStage === 'login_submit' ? 'observe_result' : null,
            navigationError: 'navigation_error',
            acceptedCount: null,
          }),
          'sample_user',
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === 'source_unavailable' &&
        error.message === `${expectedMessage}: navigation_error` &&
        error.details?.failureStage === failureStage &&
        error.details?.loginSubmitStep ===
          (failureStage === 'login_submit' ? 'observe_result' : null),
    )
  }
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
        if (input.endsWith('/execute')) return Promise.resolve(interactPayload())
        return Promise.resolve({
          success: true,
          id: SESSION_ID,
        })
      },
    )

    equal(await provider.fetchAcceptedCount('sample_user'), 10)
    equal(calls.length, 3)
    equal(
      calls.filter((call) => call.method === 'POST' && call.input.endsWith('/execute')).length,
      1,
    )

    const sessionBody = JSON.parse(calls[0].body) as Record<string, unknown>
    equal(calls[0].input, 'https://firecrawl.example/v2/interact')
    equal(calls[0].method, 'POST')
    equal(sessionBody.ttl, 120)
    equal(sessionBody.activityTtl, 120)
    equal(sessionBody.streamWebView, false)
    equal(sessionBody.recordSession, false)
    equal('profile' in sessionBody, false)
    equal(calls[0].body.includes('service_user'), false)
    equal(calls[0].body.includes('service-pass-value'), false)

    const interactBody = JSON.parse(calls[1].body) as Record<string, unknown>
    equal(calls[1].input, `https://firecrawl.example/v2/interact/${SESSION_ID}/execute`)
    equal(calls[1].method, 'POST')
    equal(interactBody.language, 'node')
    equal(interactBody.timeout, 90)
    const code = String(interactBody.code)
    equal(code.includes('https://qoj.ac/login?locale=en'), true)
    equal(code.includes('/user/profile/sample_user?locale=en'), true)
    equal(code.includes('process.stdout.write'), true)
    equal(code.includes('console.log'), false)
    equal(code.includes('error.message'), false)
    equal(code.includes("'navigation_error'"), true)
    equal(code.includes("let loginFailureStage = 'login_navigation'"), true)
    equal(code.includes("loginFailureStage = 'login_selector'"), true)
    equal(code.includes("loginFailureStage = 'login_submit'"), true)
    equal(code.includes("loginSubmitStep = 'fill_username'"), true)
    equal(code.includes("loginSubmitStep = 'fill_password'"), true)
    equal(code.includes("loginSubmitStep = 'click_submit'"), true)
    equal(code.includes("loginSubmitStep = 'observe_result'"), true)
    equal(code.includes('while (Date.now() < loginDeadline)'), true)
    equal(code.includes('QOJ login result could not be observed'), true)
    equal(code.includes('loginResponseStatus'), true)
    equal(code.includes('{ ...inspectedLoginState, fetchFailed: true }'), true)
    equal(code.split('service_user').length - 1, 1)
    equal(code.split('service-pass-value').length - 1, 1)

    equal(calls[2].input, `https://firecrawl.example/v2/interact/${SESSION_ID}`)
    equal(calls[2].method, 'DELETE')
    equal(calls[2].body, '')
  },
)

Deno.test(
  'QOJ Firecrawl provider reports session cleanup without exposing identifiers',
  async () => {
    const originalInfo = console.info
    const originalWarn = console.warn
    const infoLogs: string[] = []
    const warningLogs: string[] = []
    console.info = (...values: unknown[]) => infoLogs.push(values.map(String).join(' '))
    console.warn = (...values: unknown[]) => warningLogs.push(values.map(String).join(' '))

    try {
      const successfulCleanupProvider = createFirecrawlQojProvider(
        'test-api-key',
        'service_user',
        'service-pass-value',
        'https://firecrawl.example',
        (input, options) => {
          if (options.method === 'DELETE') return Promise.resolve({ success: true })
          if (input.endsWith('/execute')) return Promise.resolve(interactPayload())
          return Promise.resolve({
            success: true,
            id: SESSION_ID,
          })
        },
      )

      equal(await successfulCleanupProvider.fetchAcceptedCount('sample_user'), 10)
      equal(infoLogs.length, 1)
      equal(infoLogs[0], JSON.stringify({ event: 'qoj_firecrawl_session_cleanup_succeeded' }))
      equal(infoLogs[0].includes(SESSION_ID), false)

      const failedCleanupProvider = createFirecrawlQojProvider(
        'test-api-key',
        'service_user',
        'service-pass-value',
        'https://firecrawl.example',
        (input, options) => {
          if (options.method === 'DELETE') return Promise.resolve({ success: false })
          if (input.endsWith('/execute')) return Promise.resolve(interactPayload())
          return Promise.resolve({
            success: true,
            id: SESSION_ID,
          })
        },
      )

      equal(await failedCleanupProvider.fetchAcceptedCount('sample_user'), 10)
      equal(warningLogs.length, 1)
      equal(warningLogs[0], JSON.stringify({ event: 'qoj_firecrawl_session_cleanup_failed' }))
      equal(warningLogs[0].includes(SESSION_ID), false)

      const primaryFailureWithFailedCleanupProvider = createFirecrawlQojProvider(
        'test-api-key',
        'service_user',
        'service-pass-value',
        'https://firecrawl.example',
        (input, options) => {
          if (options.method === 'DELETE') return Promise.resolve({ success: false })
          if (input.endsWith('/execute')) {
            return Promise.resolve(
              interactPayload('sample_user', 0, {
                pathname: '/login',
                profileUsername: null,
                isLogin: true,
                hasLogout: false,
                loginFailure: 'credentials_rejected',
                acceptedCount: null,
              }),
            )
          }
          return Promise.resolve({
            success: true,
            id: SESSION_ID,
          })
        },
      )

      await rejects(
        () => primaryFailureWithFailedCleanupProvider.fetchAcceptedCount('sample_user'),
        (error: unknown) =>
          error instanceof HttpError &&
          error.code === 'auth_expired' &&
          error.retryable === false &&
          error.details?.firecrawlJobId === undefined,
      )
      equal(warningLogs.length, 2)
      equal(warningLogs[1], JSON.stringify({ event: 'qoj_firecrawl_session_cleanup_failed' }))
    } finally {
      console.info = originalInfo
      console.warn = originalWarn
    }
  },
)

Deno.test('QOJ cleanup reporter failures never replace the synchronization result', async () => {
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) return Promise.resolve(interactPayload())
      return Promise.resolve({
        success: true,
        id: SESSION_ID,
      })
    },
    () => {
      throw new Error('synthetic log transport failure')
    },
  )

  equal(await provider.fetchAcceptedCount('sample_user'), 10)
})

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

Deno.test('QOJ Firecrawl provider requires a standalone browser session id', async () => {
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

Deno.test('QOJ Firecrawl provider keeps the browser session id out of failures', async () => {
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) {
        return Promise.resolve(
          interactPayload('sample_user', 0, {
            fetchFailed: true,
            failureStage: 'profile_navigation',
            responseStatus: 502,
            acceptedCount: null,
          }),
        )
      }
      return Promise.resolve({
        success: true,
        id: SESSION_ID,
      })
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.message === 'QOJ profile returned HTTP 502' &&
      error.details?.firecrawlJobId === undefined,
  )
})

Deno.test('QOJ page HTTP 403 does not invalidate a healthy Firecrawl key', async () => {
  const calls: Array<{ method: string }> = []
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      calls.push({ method: String(options.method ?? 'GET') })
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) {
        return Promise.resolve(
          interactPayload('sample_user', 0, {
            fetchFailed: true,
            failureStage: 'profile_navigation',
            responseStatus: 403,
            acceptedCount: null,
          }),
        )
      }
      return Promise.resolve({ success: true, id: SESSION_ID })
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'source_unavailable' &&
      error.status === 403 &&
      error.retryable === true &&
      error.details?.failureStage === 'profile_navigation' &&
      error.details?.authTarget === undefined,
  )
  deepStrictEqual(calls, [{ method: 'POST' }, { method: 'POST' }, { method: 'DELETE' }])
})

Deno.test(
  'QOJ Firecrawl provider closes the session after rejected service credentials',
  async () => {
    const calls: Array<{ input: string; method: string; retries: number | undefined }> = []
    const provider = createFirecrawlQojProvider(
      'test-api-key',
      'service_user',
      'service-pass-value',
      'https://firecrawl.example',
      (input, options) => {
        calls.push({
          input,
          method: String(options.method ?? 'GET'),
          retries: options.retries,
        })
        if (options.method === 'DELETE') return Promise.resolve({ success: true })
        if (input.endsWith('/execute')) {
          return Promise.resolve(
            interactPayload('sample_user', 0, {
              pathname: '/login',
              profileUsername: null,
              isLogin: true,
              hasLogout: false,
              loginFailure: 'credentials_rejected',
              acceptedCount: null,
            }),
          )
        }
        return Promise.resolve({
          success: true,
          id: SESSION_ID,
        })
      },
    )

    await rejects(
      () => provider.fetchAcceptedCount('sample_user'),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === 'auth_expired' &&
        error.retryable === false &&
        error.details?.firecrawlJobId === undefined,
    )
    equal(calls.length, 3)
    equal(calls[1].method, 'POST')
    equal(calls[1].retries, 0)
    equal(calls[2].method, 'DELETE')
    equal(calls[2].retries, 0)
  },
)

Deno.test('QOJ Firecrawl provider closes the session after a Cloudflare challenge', async () => {
  const calls: Array<{ method: string; retries: number | undefined }> = []
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      calls.push({ method: String(options.method ?? 'GET'), retries: options.retries })
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) {
        return Promise.resolve(
          interactPayload('sample_user', 0, {
            pathname: '/',
            profileUsername: null,
            isLogin: false,
            hasLogout: false,
            challenge: true,
            acceptedCount: null,
          }),
        )
      }
      return Promise.resolve({
        success: true,
        id: SESSION_ID,
      })
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'source_unavailable' &&
      error.retryable === true &&
      error.details?.firecrawlJobId === undefined,
  )
  equal(calls.length, 3)
  equal(calls[1].retries, 0)
  equal(calls[2].method, 'DELETE')
})

Deno.test('QOJ interact rate limits use one request per attempt', async () => {
  const calls: Array<{ method: string; retries: number | undefined }> = []
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      calls.push({ method: String(options.method ?? 'GET'), retries: options.retries })
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) {
        return Promise.reject(
          new HttpError('Upstream returned HTTP 429', 'rate_limited', true, 429),
        )
      }
      return Promise.resolve({
        success: true,
        id: SESSION_ID,
      })
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'rate_limited' &&
      error.status === 429 &&
      error.retryable === true &&
      error.details?.firecrawlJobId === undefined,
  )
  equal(calls.length, 3)
  equal(calls[1].method, 'POST')
  equal(calls[1].retries, 0)
  equal(calls[2].method, 'DELETE')
  equal(calls[2].retries, 0)
})

Deno.test('QOJ execute transport failures preserve the browser execution stage', async () => {
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) {
        return Promise.reject(
          new HttpError('Upstream returned HTTP 502', 'source_unavailable', true, 502),
        )
      }
      return Promise.resolve({ success: true, id: SESSION_ID })
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'source_unavailable' &&
      error.status === 502 &&
      error.details?.failureStage === 'browser_execute',
  )
})

Deno.test('QOJ session creation limits use one request per attempt', async () => {
  const calls: Array<{ method: string; retries: number | undefined }> = []
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (_input, options) => {
      calls.push({ method: String(options.method ?? 'GET'), retries: options.retries })
      return Promise.reject(new HttpError('Upstream returned HTTP 429', 'rate_limited', true, 429))
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'rate_limited' &&
      error.status === 429 &&
      error.retryable === true,
  )
  equal(calls.length, 1)
  equal(calls[0].method, 'POST')
  equal(calls[0].retries, 0)
})

Deno.test('QOJ session creation 404 is not mislabeled as a destroyed session', async () => {
  const calls: Array<{ method: string }> = []
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (_input, options) => {
      calls.push({ method: String(options.method ?? 'GET') })
      return Promise.reject(new HttpError('Upstream returned HTTP 404', 'not_found', false, 404))
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'source_unavailable' &&
      error.status === 404 &&
      error.retryable === true &&
      error.message === 'Firecrawl standalone browser endpoint is unavailable' &&
      error.details?.failureStage === 'session_create',
  )
  equal(calls.length, 1)
  equal(calls[0].method, 'POST')
})

Deno.test('QOJ Firecrawl provider maps a busy interact session without retrying', async () => {
  const calls: Array<{ method: string; retries: number | undefined }> = []
  const provider = createFirecrawlQojProvider(
    'test-api-key',
    'service_user',
    'service-pass-value',
    'https://firecrawl.example',
    (input, options) => {
      calls.push({ method: String(options.method ?? 'GET'), retries: options.retries })
      if (options.method === 'DELETE') return Promise.resolve({ success: true })
      if (input.endsWith('/execute')) {
        return Promise.reject(
          new HttpError('Upstream returned HTTP 409', 'source_unavailable', false, 409),
        )
      }
      return Promise.resolve({
        success: true,
        id: SESSION_ID,
      })
    },
  )

  await rejects(
    () => provider.fetchAcceptedCount('sample_user'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'rate_limited' &&
      error.status === 409 &&
      error.retryable === true &&
      error.details?.firecrawlJobId === undefined,
  )
  equal(calls.length, 3)
  equal(calls[1].method, 'POST')
  equal(calls[1].retries, 0)
  equal(calls[2].method, 'DELETE')
  equal(calls[2].retries, 0)
})

Deno.test(
  'QOJ Firecrawl provider maps a destroyed standalone session without retrying',
  async () => {
    const calls: Array<{ method: string }> = []
    const provider = createFirecrawlQojProvider(
      'test-api-key',
      'service_user',
      'service-pass-value',
      'https://firecrawl.example',
      (input, options) => {
        calls.push({ method: String(options.method ?? 'GET') })
        if (options.method === 'DELETE') return Promise.resolve({ success: true })
        if (input.endsWith('/execute')) {
          return Promise.reject(
            new HttpError('Upstream returned HTTP 410', 'source_unavailable', true, 410),
          )
        }
        return Promise.resolve({ success: true, id: SESSION_ID })
      },
    )

    await rejects(
      () => provider.fetchAcceptedCount('sample_user'),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === 'source_unavailable' &&
        error.status === 410 &&
        error.retryable === true &&
        error.message === 'Firecrawl QOJ browser session was destroyed',
    )
    equal(calls.length, 3)
    equal(calls[2].method, 'DELETE')
  },
)

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
  equal(result.sourceVersion, 'qoj-firecrawl-interact-v2')
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

Deno.test('QOJ adapter reports the exact missing service configuration boundary', async () => {
  const result = await createQojAdapter({ provider: null }).sync('sample_user')

  equal(result.ok, false)
  if (result.ok) throw new Error('Expected QOJ synchronization to fail')
  equal(result.error.code, 'auth_required')
  equal(result.error.retryable, false)
  deepStrictEqual(result.error.details, {
    requiredSecrets: ['FIRECRAWL_API_KEY', 'QOJ_SERVICE_USERNAME', 'QOJ_SERVICE_PASSWORD'],
  })
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
