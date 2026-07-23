export interface ImageDeletionJob {
  attachmentId: string
  objectKey: string
  attempt: number
}

export interface ImageCleanupServices {
  hasDeadLetters(): Promise<boolean>
  reconcileStorageAccounting(): Promise<boolean>
  claimJobs(ownerToken: string, limit: number, leaseSeconds: number): Promise<ImageDeletionJob[]>
  deleteObject(objectKey: string): Promise<void>
  completeJob(attachmentId: string, ownerToken: string): Promise<boolean>
  retryJob(
    attachmentId: string,
    ownerToken: string,
    errorCode: string,
    retryAfterSeconds: number,
  ): Promise<boolean>
}

export interface ImageCleanupHandlerDependencies {
  isServiceRoleToken(token: string): boolean
  createServices(): ImageCleanupServices
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
  defaultLimit?: number
  leaseSeconds?: number
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim()
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID()
}

function bearerToken(request: Request): string {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new ApiError(401, 'unauthorized', 'Service role authorization is required')
  return match[1]
}

async function parseLimit(request: Request, fallback: number): Promise<number> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json')
  }
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    throw new ApiError(413, 'request_too_large', 'Cleanup request is too large')
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > 4_096) {
    throw new ApiError(413, 'request_too_large', 'Cleanup request is too large')
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ApiError(400, 'invalid_request', 'Cleanup request must be valid UTF-8 JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_request', 'Cleanup request must be an object')
  }
  const body = value as Record<string, unknown>
  if (Object.keys(body).some((field) => field !== 'limit')) {
    throw new ApiError(400, 'invalid_request', 'Cleanup request contains unsupported fields')
  }
  const limit = body.limit ?? fallback
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'invalid_request', 'Cleanup limit must be between 1 and 100')
  }
  return limit
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(3_600, 30 * 2 ** Math.max(0, Math.min(attempt - 1, 7)))
}

async function reportSafely(
  dependencies: ImageCleanupHandlerDependencies,
  request: Request,
  error: unknown,
): Promise<void> {
  try {
    await dependencies.reportUnexpectedError(request, error)
  } catch {
    // Monitoring failure must not leave a claimed row without a retry transition.
  }
}

export function createImageCleanupHandler(
  dependencies: ImageCleanupHandlerDependencies,
): (request: Request) => Promise<Response> {
  const defaultLimit = dependencies.defaultLimit ?? 20
  const leaseSeconds = dependencies.leaseSeconds ?? 600
  if (!Number.isSafeInteger(defaultLimit) || defaultLimit < 1 || defaultLimit > 100) {
    throw new Error('Cleanup default limit must be between 1 and 100')
  }
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 900) {
    throw new Error('Cleanup lease must be between 60 and 900 seconds')
  }

  return async (request) => {
    const currentRequestId = requestId(request)
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': currentRequestId,
        },
      })

    if (request.method !== 'POST') {
      return respond({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, 405)
    }

    try {
      const token = bearerToken(request)
      if (!dependencies.isServiceRoleToken(token)) {
        throw new ApiError(403, 'service_role_required', 'Service role authorization is required')
      }
      const limit = await parseLimit(request, defaultLimit)
      const services = dependencies.createServices()
      const ownerToken = crypto.randomUUID()
      const deadLettersBefore = await services.hasDeadLetters()
      const jobs = await services.claimJobs(ownerToken, limit, leaseSeconds)

      let deleted = 0
      let retried = 0
      let deadLettered = 0
      for (const job of jobs) {
        try {
          await services.deleteObject(job.objectKey)
          if (!(await services.completeJob(job.attachmentId, ownerToken))) {
            throw new Error('Image deletion completion was not confirmed')
          }
          deleted += 1
        } catch (error) {
          await reportSafely(dependencies, request, error)
          const transitioned = await services.retryJob(
            job.attachmentId,
            ownerToken,
            'storage_delete_failed',
            retryDelaySeconds(job.attempt),
          )
          if (!transitioned) {
            await reportSafely(
              dependencies,
              request,
              new Error('Image deletion retry transition was not confirmed'),
            )
            throw new ApiError(
              500,
              'retry_transition_failed',
              'Image cleanup could not schedule a retry',
            )
          }
          if (job.attempt >= 25) deadLettered += 1
          else retried += 1
        }
      }

      const deadLettersOutstanding = deadLettersBefore || (await services.hasDeadLetters())
      const storageAccountingConsistent = await services.reconcileStorageAccounting()
      return respond(
        {
          claimed: jobs.length,
          deleted,
          retried,
          deadLettered,
          deadLettersOutstanding,
          storageAccountingConsistent,
          requestId: currentRequestId,
        },
        retried > 0 || deadLettered > 0 || deadLettersOutstanding || !storageAccountingConsistent
          ? 207
          : 200,
      )
    } catch (error) {
      if (!(error instanceof ApiError)) await reportSafely(dependencies, request, error)
      const responseError =
        error instanceof ApiError
          ? error
          : new ApiError(500, 'internal_error', 'Image cleanup is temporarily unavailable')
      return respond(
        {
          error: { code: responseError.code, message: responseError.message },
          requestId: currentRequestId,
        },
        responseError.status,
      )
    }
  }
}
