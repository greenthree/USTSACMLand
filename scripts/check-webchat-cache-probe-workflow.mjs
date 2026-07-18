import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/webchat-cache-probe.yml', import.meta.url)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

export function verifyWebChatCacheProbeWorkflow(workflow) {
  requireMatch(
    workflow,
    /^\s{2}workflow_dispatch:\s*$/m,
    'Production cache probe must require a controlled manual dispatch.',
  )
  if (/^\s{2}(?:push|pull_request|schedule|workflow_run):\s*$/m.test(workflow)) {
    throw new Error('Production cache probe must not run automatically or for pull requests.')
  }
  requireMatch(
    workflow,
    /^permissions:\s*\r?\n\s{2}contents:\s*read\s*$/m,
    'Production cache probe must keep read-only repository permissions.',
  )
  requireMatch(
    workflow,
    /group:\s*webchat-production-cache-probe\s*\r?\n\s*cancel-in-progress:\s*false/,
    'Production cache probes must serialize without cancellation.',
  )

  for (const secret of ['SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY']) {
    requireMatch(
      workflow,
      new RegExp(`${secret}:\\s*\\$\\{\\{ secrets\\.${secret} \\}\\}`),
      `Production cache probe must bind ${secret} from GitHub Secrets.`,
    )
  }
  if (/CHAT_RELAY_(?:BASE_URL|API_KEY|MODEL)/.test(workflow)) {
    throw new Error(
      'Production cache probe must read relay configuration only from Supabase Vault.',
    )
  }
  if (/run:\s*[^\r\n]*(?:SUPABASE_SERVICE_ROLE_KEY|secrets\.)/m.test(workflow)) {
    throw new Error(
      'Production cache probe credentials must never be interpolated on a command line.',
    )
  }

  requireMatch(
    workflow,
    /run:\s*node scripts\/check-webchat-cache-probe-workflow\.mjs/,
    'Production cache probe must verify its own workflow invariants.',
  )
  requireMatch(
    workflow,
    /run:\s*node scripts\/check-webchat-production-cache-probe\.mjs/,
    'Production cache probe must execute the checked-in service-function client.',
  )
  requireMatch(
    workflow,
    /WEBCHAT_CACHE_PROBE_REPORT_PATH:\s*artifacts\/webchat-production-cache-probe\.json/,
    'Production cache probe must use the reviewed sanitized report path.',
  )

  for (const pinnedAction of [
    'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  ]) {
    if (!workflow.includes(pinnedAction)) {
      throw new Error(`Production cache probe must pin reviewed action ${pinnedAction}.`)
    }
  }

  const uploadStart = workflow.indexOf('- name: Upload sanitized cache probe report')
  if (uploadStart < 0) throw new Error('Production cache probe is missing its report upload.')
  const upload = workflow.slice(uploadStart)
  requireMatch(upload, /if:\s*always\(\)/, 'Cache probe evidence must upload after failures too.')
  const uploadPaths = [...upload.matchAll(/^\s+path:\s*([^\r\n]+)\s*$/gm)].map((match) =>
    match[1].trim(),
  )
  if (
    uploadPaths.length !== 1 ||
    uploadPaths[0] !== 'artifacts/webchat-production-cache-probe.json'
  ) {
    throw new Error('Only the exact sanitized cache probe report file may be uploaded.')
  }
  requireMatch(upload, /retention-days:\s*14/, 'Cache probe evidence must expire after 14 days.')
  if (/\.env|SUPABASE_SERVICE_ROLE_KEY|node_modules|dist\//.test(upload)) {
    throw new Error('Cache probe artifact upload contains a forbidden path or secret name.')
  }

  return { manualOnly: true, vaultOnly: true, retentionDays: 14 }
}

async function main() {
  const workflow = await readFile(workflowUrl, 'utf8')
  const report = verifyWebChatCacheProbeWorkflow(workflow)
  console.log(
    `Verified WebChat production cache probe: manual-only, Vault-only relay config, ${report.retentionDays}-day sanitized evidence.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
