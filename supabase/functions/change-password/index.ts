import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { createChangePasswordHandler } from './handler.ts'
import { isSessionRevocationConfirmed } from './session-revocation.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const handler = createChangePasswordHandler({
  createServices() {
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = requiredEnv('SUPABASE_ANON_KEY')
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const passwordClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    return {
      async getUser(token: string) {
        const { data, error } = await serviceClient.auth.getUser(token)
        if (error || !data.user) return null
        return { id: data.user.id, email: data.user.email ?? null }
      },
      async verifyPassword(email: string, password: string) {
        const { data, error } = await passwordClient.auth.signInWithPassword({ email, password })
        return error ? null : (data.user?.id ?? null)
      },
      async updatePassword(userId: string, password: string) {
        const { error } = await serviceClient.auth.admin.updateUserById(userId, { password })
        return !error
      },
      async revokeSessions(token: string) {
        const { error } = await serviceClient.auth.admin.signOut(token, 'global')
        // Updating the password may invalidate the caller's JWT before the
        // explicit logout request runs. Supabase Auth's browser client treats
        // 401/403/404 and session_not_found as an already-signed-out success.
        return isSessionRevocationConfirmed(error)
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('change-password', request, error))
  },
})

Deno.serve(handler)
