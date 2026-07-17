const QUEUE_SCHEDULER_HEADER = 'x-sync-queue-token'
const MIN_TOKEN_LENGTH = 32
const MAX_TOKEN_LENGTH = 256

function validTokenShape(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_TOKEN_LENGTH &&
    value.length <= MAX_TOKEN_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  )
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function constantTimeTokenEquals(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)])
  let difference = 0
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index]
  }
  return difference === 0
}

export async function hasValidQueueSchedulerToken(
  request: Request,
  configuredToken: string | undefined,
): Promise<boolean> {
  const suppliedToken = request.headers.get(QUEUE_SCHEDULER_HEADER)
  if (!validTokenShape(configuredToken) || !validTokenShape(suppliedToken)) return false
  return await constantTimeTokenEquals(suppliedToken, configuredToken)
}

export function queueSchedulerMayProcessScope(queueScheduler: boolean, scope: string): boolean {
  return !queueScheduler || scope === 'queue'
}

export function queueSchedulerDownstreamToken(
  queueScheduler: boolean,
  bearerToken: string,
  serviceRoleKey: string,
): string {
  return queueScheduler ? serviceRoleKey : bearerToken
}
