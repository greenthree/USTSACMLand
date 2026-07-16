import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  canSelfDeleteAccount,
  DeleteAccountRequestError,
  parseDeleteAccountRequest,
} from './request.ts'
import type { SafeDeletionResult } from './safe-deletion.ts'

export interface DeletionUser {
  id: string
  email: string | null
}

export interface DeleteAccountServices {
  getUser(token: string): Promise<DeletionUser | null>
  getProfileRole(userId: string): Promise<'member' | 'admin' | null>
  verifyPassword(email: string, password: string): Promise<string | null>
  countActiveSyncJobs(userId: string): Promise<number>
  deleteUserWithRecoveryFloor(userId: string): Promise<SafeDeletionResult>
}

export interface DeleteAccountHandlerDependencies {
  createServices(request: Request): DeleteAccountServices
  reportUnexpectedError(request: Request, error: unknown): Promise<void>
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function bearerToken(request: Request): string {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApiError(401, 'Missing bearer token')
  return match[1]
}

export function createDeleteAccountHandler(
  dependencies: DeleteAccountHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const respond = (body: unknown, status = 200) => jsonResponse(body, status, request)
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders(request) })
    }
    if (request.method !== 'POST') {
      return respond({ error: 'Method not allowed' }, 405)
    }

    let currentPassword = ''
    try {
      const token = bearerToken(request)
      let body: unknown
      try {
        body = await request.json()
      } catch {
        throw new ApiError(400, 'Request body must be valid JSON')
      }
      try {
        currentPassword = parseDeleteAccountRequest(body).currentPassword
      } catch (error) {
        if (error instanceof DeleteAccountRequestError) {
          throw new ApiError(400, error.message)
        }
        throw error
      }

      const services = dependencies.createServices(request)
      const user = await services.getUser(token)
      if (!user) {
        throw new ApiError(401, 'Invalid or expired session')
      }
      if (!user.email) {
        throw new ApiError(409, 'This account has no password email identity')
      }

      const role = await services.getProfileRole(user.id)
      if (role === null) {
        throw new ApiError(404, 'Member profile was not found')
      }
      if (!canSelfDeleteAccount(role)) {
        throw new ApiError(403, 'Administrator accounts cannot use self-service deletion')
      }

      const verifiedUserId = await services.verifyPassword(user.email, currentPassword)
      currentPassword = ''
      if (verifiedUserId !== user.id) {
        throw new ApiError(401, 'Current password is incorrect')
      }

      if ((await services.countActiveSyncJobs(user.id)) > 0) {
        throw new ApiError(
          409,
          'Account synchronization is active; retry deletion after it finishes',
        )
      }

      const deletionResult = await services.deleteUserWithRecoveryFloor(user.id)
      switch (deletionResult) {
        case 'deleted':
          return respond({ deleted: true })
        case 'recovery_unavailable':
          throw new ApiError(
            503,
            'Account deletion safety record is unavailable; no account data was deleted',
          )
        case 'deletion_failed':
          throw new ApiError(
            409,
            'Account deletion could not complete; retry after active work finishes',
          )
        default:
          throw new Error('Account deletion returned an unsupported result')
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500
      const message =
        error instanceof ApiError
          ? error.message
          : 'Account deletion is temporarily unavailable; please retry later'
      if (!(error instanceof ApiError)) {
        await dependencies.reportUnexpectedError(request, error)
      }
      return respond({ error: message }, status)
    } finally {
      currentPassword = ''
    }
  }
}
