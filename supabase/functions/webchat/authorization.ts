export interface AuthUserData {
  user: { id: string } | null
}

export interface AuthLookupError {
  status?: number
}

export function resolveAuthenticatedUser(
  data: AuthUserData,
  error: AuthLookupError | null,
): { id: string } | null {
  if (data.user) return { id: data.user.id }
  if (!error || [400, 401, 403].includes(error.status ?? 0)) return null
  throw new Error('Supabase Auth lookup failed')
}
