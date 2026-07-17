import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workflowUrl = new URL('../.github/workflows/webchat-relay-smoke.yml', import.meta.url)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message)
}

export function verifyWebChatRelayWorkflow(workflow) {
  requireMatch(
    workflow,
    /^\s{2}workflow_dispatch:\s*$/m,
    'WebChat relay smoke must require a controlled manual dispatch.',
  )
  if (/^\s{2}(?:push|pull_request|schedule|workflow_run):\s*$/m.test(workflow)) {
    throw new Error('WebChat relay smoke must not run automatically or for pull requests.')
  }
  requireMatch(
    workflow,
    /^permissions:\s*\r?\n\s{2}contents:\s*read\s*$/m,
    'WebChat relay smoke must use a read-only GITHUB_TOKEN.',
  )
  requireMatch(
    workflow,
    /cancel-in-progress:\s*false/,
    'A billable compatibility smoke must not be silently cancelled by another run.',
  )
  requireMatch(
    workflow,
    /timeout-minutes:\s*10/,
    'WebChat relay smoke must have a ten-minute job timeout.',
  )

  for (const secret of ['CHAT_RELAY_BASE_URL', 'CHAT_RELAY_API_KEY', 'CHAT_RELAY_MODEL']) {
    requireMatch(
      workflow,
      new RegExp(`${secret}:\\s*\\$\\{\\{ secrets\\.${secret} \\}\\}`),
      `${secret} must come from an Actions Secret.`,
    )
  }
  if (/run:\s*[^\r\n]*(?:CHAT_RELAY_|secrets\.)/m.test(workflow)) {
    throw new Error('Relay credentials must not be interpolated into a shell command.')
  }
  requireMatch(
    workflow,
    /WEBCHAT_RELAY_ABORT_CHECK:\s*\$\{\{ inputs\.include_abort \}\}/,
    'The manual workflow must expose the Abort compatibility toggle.',
  )
  requireMatch(
    workflow,
    /WEBCHAT_RELAY_REPORT_PATH:\s*artifacts\/webchat-relay-compatibility\.json/,
    'The relay smoke must write its sanitized report to the reviewed artifact path.',
  )
  requireMatch(
    workflow,
    /run:\s*npm run check:webchat-relay\s*$/m,
    'The workflow must execute the checked-in relay compatibility command.',
  )

  for (const pinnedAction of [
    'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  ]) {
    if (!workflow.includes(pinnedAction)) {
      throw new Error(`WebChat relay workflow must pin reviewed action ${pinnedAction}.`)
    }
  }

  const uploadStart = workflow.indexOf('- name: Upload sanitized compatibility report')
  if (uploadStart < 0) throw new Error('WebChat relay workflow is missing its report upload.')
  const upload = workflow.slice(uploadStart)
  requireMatch(upload, /if:\s*always\(\)/, 'Compatibility evidence must upload after failures too.')
  requireMatch(
    upload,
    /path:\s*artifacts\/webchat-relay-compatibility\.json/,
    'Only the sanitized compatibility report may be uploaded.',
  )
  requireMatch(upload, /retention-days:\s*14/, 'Compatibility evidence must expire after 14 days.')
  if (/\.env|CHAT_RELAY_API_KEY|node_modules|dist\//.test(upload)) {
    throw new Error('Compatibility artifact upload contains a forbidden path or secret name.')
  }

  return { manualOnly: true, retentionDays: 14, abortCheck: true }
}

async function main() {
  const workflow = await readFile(workflowUrl, 'utf8')
  const report = verifyWebChatRelayWorkflow(workflow)
  console.log(
    `Verified WebChat relay workflow: manual-only, Abort=${report.abortCheck}, ${report.retentionDays}-day sanitized evidence.`,
  )
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  await main()
}
