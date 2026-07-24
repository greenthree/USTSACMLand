import {
  createFirecrawlQojProvider,
  type QojSessionCleanupStatus,
} from '../supabase/functions/_shared/adapters/qoj.ts'
import {
  fetchJson,
  type FetchWithRetryOptions,
  HttpError,
} from '../supabase/functions/_shared/http.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const challengeCode = String.raw`
  await page.setContent('<main class="challenge-platform"><h1>Just a moment</h1><p>Checking your browser</p></main>');
  const pageText = await page.locator('body').innerText().catch(() => '');
  const challenge = /\bJust a moment\b|\bChecking your browser\b/i.test(pageText)
    || await page.locator('#challenge-form, .challenge-platform, [class*="cf-chl-"]').count() > 0;
  process.stdout.write('QOJ_RESULT:' + JSON.stringify({
    pathname: '/controlled-challenge',
    profileUsername: null,
    isLogin: false,
    hasLogout: false,
    loginFailure: null,
    notFound: false,
    challenge,
    rateLimited: false,
    fetchFailed: false,
    failureStage: null,
    loginSubmitStep: null,
    responseStatus: 200,
    navigationError: null,
    acceptedCount: null,
  }) + '\n');
`

let cleanupStatus: QojSessionCleanupStatus | null = null
const provider = createFirecrawlQojProvider(
  requiredEnv('FIRECRAWL_API_KEY'),
  'controlled_probe',
  'controlled-probe',
  'https://api.firecrawl.dev',
  (input: string, options: FetchWithRetryOptions) => {
    if (!input.endsWith('/execute')) return fetchJson<unknown>(input, options)

    const originalBody = JSON.parse(String(options.body)) as Record<string, unknown>
    return fetchJson<unknown>(input, {
      ...options,
      body: JSON.stringify({ ...originalBody, code: challengeCode }),
    })
  },
  (status) => {
    cleanupStatus = status
  },
)

try {
  await provider.fetchAcceptedCount('controlled_probe')
  throw new Error('Controlled challenge unexpectedly succeeded')
} catch (error) {
  if (
    !(error instanceof HttpError) ||
    error.code !== 'source_unavailable' ||
    error.retryable !== true
  ) {
    throw error
  }

  console.log(
    JSON.stringify({
      ok: true,
      code: error.code,
      retryable: error.retryable,
      challengeClassified: true,
      cleanupStatus,
    }),
  )
}
