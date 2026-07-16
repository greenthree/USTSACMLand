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

if (
  !workflow.includes('Sync page $page_number summary: $safe_summary') ||
  !workflow.includes('.byPlatform // []') ||
  !workflow.includes('hasMore: (.nextCursor != null)')
) {
  throw new Error('Sync workflow must log the sanitized paginated platform summary.')
}

for (const paginationInvariant of [
  'if $scope == "queue" then {} else {batch_size: 3}',
  'if $scope == "queue" or $cursor == "" then {} else {cursor: ($cursor | tonumber)} end',
  'next_cursor="$(jq -r \'.nextCursor // empty\' response.json)"',
  'Sync pagination did not advance.',
  'Sync pagination exceeded $max_pages pages.',
  'had_failures=1',
  'failed_total=$((failed_total + failed_count))',
  'Sync request completed all pages with $failed_total failed member result(s).',
]) {
  if (!workflow.includes(paginationInvariant)) {
    throw new Error(`Sync workflow is missing pagination invariant: ${paginationInvariant}`)
  }
}

if (/\.error\.message/.test(workflow)) {
  throw new Error('Sync workflow must not print raw adapter error messages to public logs.')
}

console.log('Verified single-attempt paginated sync dispatch and sanitized summary logging.')
