export class ChangePasswordRequestError extends Error {}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export function parseChangePasswordRequest(value: unknown): ChangePasswordRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChangePasswordRequestError('Request body must be a JSON object')
  }

  const payload = value as Record<string, unknown>
  const currentPassword = payload.currentPassword
  const newPassword = payload.newPassword
  if (
    typeof currentPassword !== 'string' ||
    currentPassword.length < 1 ||
    currentPassword.length > 256
  ) {
    throw new ChangePasswordRequestError(
      'Current password must contain between 1 and 256 characters',
    )
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256) {
    throw new ChangePasswordRequestError('New password must contain between 8 and 256 characters')
  }
  if (newPassword === currentPassword) {
    throw new ChangePasswordRequestError('New password must differ from the current password')
  }

  return { currentPassword, newPassword }
}
