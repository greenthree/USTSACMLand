export class DeleteAccountRequestError extends Error {}

export interface DeleteAccountRequest {
  currentPassword: string
}

export function parseDeleteAccountRequest(value: unknown): DeleteAccountRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeleteAccountRequestError('Request body must be a JSON object')
  }

  const password = (value as Record<string, unknown>).currentPassword
  if (typeof password !== 'string' || password.length < 1 || password.length > 256) {
    throw new DeleteAccountRequestError(
      'Current password must contain between 1 and 256 characters',
    )
  }
  return { currentPassword: password }
}

export function canSelfDeleteAccount(role: string | null | undefined): boolean {
  return role === 'member'
}
