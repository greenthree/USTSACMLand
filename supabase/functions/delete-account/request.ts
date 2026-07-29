export class DeleteAccountRequestError extends Error {}

export interface DeleteAccountRequest {
  currentPassword: string
  captchaToken: string
}

export function parseDeleteAccountRequest(value: unknown): DeleteAccountRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeleteAccountRequestError('Request body must be a JSON object')
  }

  const payload = value as Record<string, unknown>
  const password = payload.currentPassword
  const captchaToken = payload.captchaToken
  if (typeof password !== 'string' || password.length < 1 || password.length > 256) {
    throw new DeleteAccountRequestError(
      'Current password must contain between 1 and 256 characters',
    )
  }
  if (typeof captchaToken !== 'string' || captchaToken.length < 1 || captchaToken.length > 4096) {
    throw new DeleteAccountRequestError('Captcha token must contain between 1 and 4096 characters')
  }
  return { currentPassword: password, captchaToken }
}

export function canSelfDeleteAccount(role: string | null | undefined): boolean {
  return role === 'member'
}
