export type FirecrawlCreditSeverity = 'warning' | 'critical'

export interface FirecrawlCreditUsage {
  configured: boolean
  remainingCredits: number | null
  planCredits: number | null
  percentRemaining: number | null
  billingPeriodEnd: string | null
  severity: FirecrawlCreditSeverity | null
}

interface FirecrawlCreditUsageOptions {
  apiKey?: string | null
  apiUrl?: string | null
  warningPercent?: number
  criticalPercent?: number
  timeoutMs?: number
  fetcher?: typeof fetch
}

function validPercentage(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 && value! <= 100 ? value! : fallback
}

function normalizeApiUrl(value: string | null | undefined): string {
  const url = new URL(value?.trim() || 'https://api.firecrawl.dev')
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('FIRECRAWL_API_URL must be an HTTPS URL without credentials')
  }
  return url.toString().replace(/\/$/, '')
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export async function readFirecrawlCreditUsage(
  options: FirecrawlCreditUsageOptions = {},
): Promise<FirecrawlCreditUsage> {
  const apiKey = options.apiKey === undefined ? Deno.env.get('FIRECRAWL_API_KEY') : options.apiKey
  if (!apiKey?.trim()) {
    return {
      configured: false,
      remainingCredits: null,
      planCredits: null,
      percentRemaining: null,
      billingPeriodEnd: null,
      severity: null,
    }
  }

  const apiUrl = normalizeApiUrl(
    options.apiUrl === undefined ? Deno.env.get('FIRECRAWL_API_URL') : options.apiUrl,
  )
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000)
  try {
    const response = await (options.fetcher ?? fetch)(`${apiUrl}/v2/team/credit-usage`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Firecrawl credit usage returned HTTP ${response.status}`)
    }
    const payload = await response.json()
    const data = payload?.data ?? payload
    const remainingCredits = finiteNonNegative(data?.remainingCredits)
    const planCredits = finiteNonNegative(data?.planCredits)
    if (remainingCredits === null || planCredits === null || planCredits <= 0) {
      throw new Error('Firecrawl credit usage returned an invalid schema')
    }

    const percentRemaining = Math.max(0, Math.min(100, (remainingCredits / planCredits) * 100))
    const warningPercent = validPercentage(options.warningPercent, 25)
    const criticalPercent = Math.min(warningPercent, validPercentage(options.criticalPercent, 10))
    const severity =
      percentRemaining <= criticalPercent
        ? 'critical'
        : percentRemaining <= warningPercent
          ? 'warning'
          : null

    return {
      configured: true,
      remainingCredits,
      planCredits,
      percentRemaining,
      billingPeriodEnd: typeof data?.billingPeriodEnd === 'string' ? data.billingPeriodEnd : null,
      severity,
    }
  } finally {
    clearTimeout(timeout)
  }
}
