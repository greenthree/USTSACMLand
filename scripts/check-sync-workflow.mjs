import { readFileSync } from 'node:fs'

const workflowUrl = new URL('../.github/workflows/sync-stats.yml', import.meta.url)
const workflow = readFileSync(workflowUrl, 'utf8')

const forbiddenRetryFlags = [
  { label: '--retry', pattern: /--retry(?:[=\s]|$)/ },
  { label: '--retry-all-errors', pattern: /--retry-all-errors/ },
]
for (const flag of forbiddenRetryFlags) {
  if (flag.pattern.test(workflow)) {
    throw new Error(
      `Sync workflow must not contain ${flag.label}; the POST is not transport-idempotent and QOJ must never be retried automatically.`,
    )
  }
}

const postCount = workflow.match(/--request POST/g)?.length ?? 0
if (postCount !== 1 || !workflow.includes('/functions/v1/sync-stats')) {
  throw new Error(
    'Sync workflow must contain exactly one explicit POST to the sync-stats function.',
  )
}

if (!workflow.includes('Sync summary: $safe_summary') || !workflow.includes('.byPlatform // []')) {
  throw new Error('Sync workflow must log the sanitized per-platform summary.')
}

if (/\.error\.message/.test(workflow)) {
  throw new Error('Sync workflow must not print raw adapter error messages to public logs.')
}

console.log('Verified single-attempt sync workflow dispatch and sanitized summary logging.')
