import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { createDeleteAccountHandler } from './handler.ts'
import { createGitHubRecoveryFloorRecorder } from './recovery-floor.ts'
import { withRecoveryFloorLease } from './recovery-lease.ts'
import { deleteUserWithRecoveryFloor } from './safe-deletion.ts'
import { deleteAuthUserWithRecoveryLease } from './transactional-auth-deletion.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const handler = createDeleteAccountHandler({
  createServices(request) {
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
      async getProfileRole(userId: string) {
        const { data, error } = await serviceClient
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle()
        if (error) throw new Error('Could not load account deletion policy')
        return data?.role ?? null
      },
      async verifyPassword(email: string, password: string) {
        const { data, error } = await passwordClient.auth.signInWithPassword({
          email,
          password,
        })
        return error ? null : (data.user?.id ?? null)
      },
      async countActiveSyncJobs(userId: string) {
        const { count, error } = await serviceClient
          .from('sync_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', userId)
          .in('status', ['queued', 'running'])
        if (error) {
          throw new Error('Could not check active synchronization jobs')
        }
        return count ?? 0
      },
      async deleteUserWithRecoveryFloor(userId: string) {
        const recoveryOwnerToken = crypto.randomUUID()
        return await deleteUserWithRecoveryFloor(
          {
            withRecoveryLease: (action) =>
              withRecoveryFloorLease(serviceClient, action, userId, recoveryOwnerToken, {
                reportHeartbeatFailure: async (error) => {
                  await notifyRuntimeError(runtimeErrorAlert('delete-account', request, error))
                },
              }),
            async recordRecoveryFloor() {
              const recoveryFloor = createGitHubRecoveryFloorRecorder({
                repository: requiredEnv('DELETION_RECOVERY_REPOSITORY'),
                token: requiredEnv('DELETION_RECOVERY_GITHUB_TOKEN'),
              })
              await recoveryFloor.record()
            },
            async deleteUser(targetUserId: string) {
              return await deleteAuthUserWithRecoveryLease(
                serviceClient,
                recoveryOwnerToken,
                targetUserId,
              )
            },
          },
          userId,
        )
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('delete-account', request, error))
  },
})

Deno.serve(handler)
