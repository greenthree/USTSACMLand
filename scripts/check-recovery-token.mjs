import process from 'node:process'

const DEFAULT_REPOSITORY = 'greenthree/USTSACMLand'
const RECOVERY_VARIABLE = 'BACKUP_RECOVERY_NOT_BEFORE'
const TOKEN_ENV = 'DELETION_RECOVERY_GITHUB_TOKEN'

function tokenLooksUnsafe(token) {
  // Classic tokens and the old broad token formats are intentionally rejected.
  // Fine-grained tokens currently use github_pat_; the API still remains the
  // authority for the actual repository/permission selection.
  return token.startsWith('github_pat_') === false
}

export function validateRecoveryTokenShape(token) {
  if (!token || typeof token !== 'string') {
    throw new Error(`${TOKEN_ENV} is not set.`)
  }
  if (tokenLooksUnsafe(token)) {
    throw new Error(
      `${TOKEN_ENV} does not look like a GitHub fine-grained token; refusing to use a classic or unknown token format.`,
    )
  }
  return true
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'USTSACMLand recovery-token preflight',
  }
}

export async function runRecoveryTokenPreflight({
  token = process.env[TOKEN_ENV],
  repository = process.env.RECOVERY_GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
  fetchImpl = fetch,
} = {}) {
  if (repository !== DEFAULT_REPOSITORY) {
    throw new Error(`RECOVERY_GITHUB_REPOSITORY must be ${DEFAULT_REPOSITORY}.`)
  }
  validateRecoveryTokenShape(token)

  const request = async (path, options = {}) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      ...options,
      headers: { ...githubHeaders(token), ...(options.headers ?? {}) },
    })
    const body = await response.text()
    let payload = null
    try {
      payload = body ? JSON.parse(body) : null
    } catch {
      payload = null
    }
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}.`)
    return payload
  }

  const repositoryInfo = await request(`/repos/${DEFAULT_REPOSITORY}`)
  if (repositoryInfo?.full_name !== DEFAULT_REPOSITORY) {
    throw new Error('GitHub token cannot be verified against the target repository.')
  }

  const variablePath = `/repos/${DEFAULT_REPOSITORY}/actions/variables/${RECOVERY_VARIABLE}`
  const variable = await request(variablePath)
  const value = variable?.value
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 128 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('Recovery variable is missing or malformed.')
  }

  await request(variablePath, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: RECOVERY_VARIABLE, value }),
  })
  const confirmed = await request(variablePath)
  if (confirmed?.value !== value) {
    throw new Error('Recovery variable write could not be confirmed.')
  }

  return {
    repository: DEFAULT_REPOSITORY,
    variable: RECOVERY_VARIABLE,
    valueConfirmed: true,
    permissionNote:
      'GitHub API access confirms this repository and Variables read/write path; it cannot prove every fine-grained permission selected in the GitHub UI.',
  }
}

async function main() {
  try {
    const report = await runRecoveryTokenPreflight()
    console.log(`Recovery token preflight passed for ${report.repository}.`)
    console.log(
      `${report.variable} was read, written with the identical value, and read back successfully.`,
    )
    console.log(report.permissionNote)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recovery token preflight failed.'
    console.error(`BLOCKER: ${message}`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('check-recovery-token.mjs')) await main()
