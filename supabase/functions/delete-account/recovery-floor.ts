const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const RECOVERY_FLOOR_VARIABLE = 'BACKUP_RECOVERY_NOT_BEFORE'
const RECOVERY_FLOOR_SAFETY_MS = 60 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 5_000

export interface RecoveryFloorRecorderOptions {
  repository: string
  token: string
  fetcher?: typeof fetch
  now?: () => number
}

interface GitHubVariableResponse {
  name?: unknown
  value?: unknown
}

function normalizeRepository(value: string): string {
  const repository = value.trim()
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error('Deletion recovery repository is invalid')
  }
  const [owner, name] = repository.split('/')
  if (owner === '.' || owner === '..' || name === '.' || name === '..') {
    throw new Error('Deletion recovery repository is invalid')
  }
  return repository
}

function normalizeToken(value: string): string {
  const token = value.trim()
  if (token.length < 20 || token.length > 500 || /\s/.test(token)) {
    throw new Error('Deletion recovery token is invalid')
  }
  return token
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function createGitHubRecoveryFloorRecorder(options: RecoveryFloorRecorderOptions): {
  record(): Promise<string>
} {
  const repository = normalizeRepository(options.repository)
  const token = normalizeToken(options.token)
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? Date.now
  const variablePath = `/repos/${repository}/actions/variables/${RECOVERY_FLOOR_VARIABLE}`
  const collectionPath = `/repos/${repository}/actions/variables`

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new DOMException('GitHub request timed out', 'TimeoutError')),
      REQUEST_TIMEOUT_MS,
    )
    try {
      return await fetcher(`${GITHUB_API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'USTSACMLand account-deletion recovery floor',
          'x-github-api-version': GITHUB_API_VERSION,
          ...init.headers,
        },
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async function readFloor(): Promise<string | null> {
    const response = await request(variablePath)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Could not read deletion recovery floor (HTTP ${response.status})`)
    }
    const payload = (await response.json()) as GitHubVariableResponse
    if (
      payload.name !== RECOVERY_FLOOR_VARIABLE ||
      typeof payload.value !== 'string' ||
      parseTimestamp(payload.value) === null
    ) {
      throw new Error('Deletion recovery floor response is invalid')
    }
    return payload.value
  }

  async function writeFloor(value: string, exists: boolean): Promise<void> {
    const payload = JSON.stringify({ name: RECOVERY_FLOOR_VARIABLE, value })
    let response = await request(exists ? variablePath : collectionPath, {
      method: exists ? 'PATCH' : 'POST',
      body: payload,
    })

    if (!exists && (response.status === 409 || response.status === 422)) {
      response = await request(variablePath, {
        method: 'PATCH',
        body: payload,
      })
    }
    if (!response.ok) {
      throw new Error(`Could not write deletion recovery floor (HTTP ${response.status})`)
    }
  }

  return {
    async record(): Promise<string> {
      const proposedTimestamp = now() + RECOVERY_FLOOR_SAFETY_MS
      const proposedFloor = new Date(proposedTimestamp).toISOString()
      const currentFloor = await readFloor()
      const currentTimestamp = parseTimestamp(currentFloor)
      if (currentFloor && currentTimestamp !== null && currentTimestamp >= proposedTimestamp) {
        return currentFloor
      }

      await writeFloor(proposedFloor, currentFloor !== null)
      const confirmedFloor = await readFloor()
      const confirmedTimestamp = parseTimestamp(confirmedFloor)
      if (
        !confirmedFloor ||
        confirmedTimestamp === null ||
        confirmedTimestamp < proposedTimestamp
      ) {
        throw new Error('Deletion recovery floor could not be confirmed')
      }
      return confirmedFloor
    },
  }
}

export const deletionRecoveryFloorVariable = RECOVERY_FLOOR_VARIABLE
export const deletionRecoveryFloorSafetyMs = RECOVERY_FLOOR_SAFETY_MS
