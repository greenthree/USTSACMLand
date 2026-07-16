import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ChangePasswordRequestError, parseChangePasswordRequest } from './request.ts'

export interface PasswordUser {
  id: string
  email: string | null
}

export interface ChangePasswordServices {
  getUser(token: string): Promise<PasswordUser | null>
  verifyPassword(email: string, password: string): Promise<string | null>
  updatePassword(userId: string, password: string): Promise<boolean>
  revokeSessions(token: string): Promise<boolean>
}

export interface ChangePasswordHandlerDependencies {
  createServices(): ChangePasswordServices
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

export function createChangePasswordHandler(
  dependencies: ChangePasswordHandlerDependencies,
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
    let newPassword = ''
    try {
      const token = bearerToken(request)
      let body: unknown
      try {
        body = await request.json()
      } catch {
        throw new ApiError(400, 'Request body must be valid JSON')
      }

      try {
        const parsed = parseChangePasswordRequest(body)
        currentPassword = parsed.currentPassword
        newPassword = parsed.newPassword
      } catch (error) {
        if (error instanceof ChangePasswordRequestError) {
          throw new ApiError(400, error.message)
        }
        throw error
      }

      const services = dependencies.createServices()
      const user = await services.getUser(token)
      if (!user) {
        throw new ApiError(401, 'Invalid or expired session')
      }
      if (!user.email) {
        throw new ApiError(409, 'This account has no password email identity')
      }

      const verifiedUserId = await services.verifyPassword(user.email, currentPassword)
      if (verifiedUserId !== user.id) {
        throw new ApiError(401, 'Current password is incorrect')
      }

      if (!(await services.updatePassword(user.id, newPassword))) {
        throw new ApiError(409, 'Password could not be updated')
      }

      let sessionsRevoked = false
      let revocationError: unknown = new Error('Password session revocation was not confirmed')
      try {
        sessionsRevoked = await services.revokeSessions(token)
      } catch (error) {
        revocationError = error
      }
      if (!sessionsRevoked) {
        await dependencies.reportUnexpectedError(request, revocationError)
      }

      return respond({ updated: true, sessionsRevoked })
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500
      const message =
        error instanceof ApiError
          ? error.message
          : 'Password change is temporarily unavailable; please retry later'
      if (!(error instanceof ApiError)) {
        await dependencies.reportUnexpectedError(request, error)
      }
      return respond({ error: message }, status)
    } finally {
      currentPassword = ''
      newPassword = ''
    }
  }
}
