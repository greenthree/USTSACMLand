import { createFirecrawlQojProvider } from '../supabase/functions/_shared/adapters/qoj.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const accountId = Deno.args[0]?.trim() ?? ''
if (!/^[A-Za-z0-9_.-]{1,50}$/.test(accountId)) {
  console.error('Usage: check-qoj-login.ts <public QOJ username>')
  Deno.exit(2)
}

try {
  const provider = createFirecrawlQojProvider(
    requiredEnv('FIRECRAWL_API_KEY'),
    requiredEnv('QOJ_SERVICE_USERNAME'),
    requiredEnv('QOJ_SERVICE_PASSWORD'),
    Deno.env.get('FIRECRAWL_API_URL')?.trim() || 'https://api.firecrawl.dev',
  )
  const acceptedCount = await provider.fetchAcceptedCount(accountId)
  console.log(`QOJ automatic login is healthy; accepted count: ${acceptedCount}`)
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown QOJ login error'
  console.error(`QOJ automatic login check failed: ${message}`)
  Deno.exit(1)
}
