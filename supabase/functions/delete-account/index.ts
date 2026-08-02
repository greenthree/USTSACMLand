import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { createDeleteAccountHandler } from './handler.ts'
import { deleteAuthUserWithAvatarCleanup } from './avatar-cleanup.ts'
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
      async verifyPassword(email: string, password: string, captchaToken: string) {
        const { data, error } = await passwordClient.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken },
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
              return await deleteAuthUserWithAvatarCleanup(
                {
                  deleteAuthUser: (memberId) =>
                    deleteAuthUserWithRecoveryLease(serviceClient, recoveryOwnerToken, memberId),
                  async prepareAvatarDeletion(memberId) {
                    const { data, error } = await serviceClient.rpc(
                      'prepare_member_avatar_account_deletion',
                      { requested_profile_id: memberId },
                    )
                    if (error) throw new Error('Could not prepare member avatar deletion')
                    const row = Array.isArray(data) ? data[0] : null
                    if (!row || typeof row.ready !== 'boolean') {
                      throw new Error('Member avatar deletion preparation returned invalid data')
                    }
                    return { ready: row.ready }
                  },
                  async removeAvatarObjects(memberId) {
                    const prefix = `member/${memberId}`
                    for (let page = 0; page < 100; page += 1) {
                      const { data, error } = await serviceClient.storage
                        .from('member-avatars')
                        .list(prefix, {
                          limit: 100,
                          offset: 0,
                          sortBy: { column: 'name', order: 'asc' },
                        })
                      if (error) throw new Error('Could not list member avatars')
                      const objectKeys = (data ?? [])
                        .filter((item) => item.id !== null)
                        .map((item) => `${prefix}/${item.name}`)
                      if (objectKeys.length === 0) return
                      const { error: removeError } = await serviceClient.storage
                        .from('member-avatars')
                        .remove(objectKeys)
                      if (removeError) throw new Error('Could not remove member avatars')
                    }
                    throw new Error('Member avatar cleanup exceeded its bounded page limit')
                  },
                  async cancelAvatarDeletion(memberId) {
                    const { error } = await serviceClient.rpc(
                      'cancel_member_avatar_account_deletion',
                      { requested_profile_id: memberId },
                    )
                    if (error) throw new Error('Could not cancel member avatar deletion')
                  },
                },
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
