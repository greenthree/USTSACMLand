export interface SessionRevocationError {
  status?: number
  code?: string
  name?: string
}

const alreadySignedOutStatuses = new Set([401, 403, 404])

export function isSessionRevocationConfirmed(error: SessionRevocationError | null): boolean {
  if (!error) return true

  return (
    alreadySignedOutStatuses.has(error.status ?? 0) ||
    error.code === 'session_not_found' ||
    // auth-js normalizes the raw 403/session_not_found response to this
    // status-400 error before returning it from admin.signOut().
    error.name === 'AuthSessionMissingError'
  )
}
