import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { createMemberAvatarHandler } from './handler.ts'

const bucket = 'member-avatars'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const handler = createMemberAvatarHandler({
  createServices() {
    const projectUrl = requiredEnv('SUPABASE_URL')
    const publicClient = createClient(projectUrl, requiredEnv('SUPABASE_ANON_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const serviceClient = createClient(projectUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    return {
      async readVisibleAvatar(memberId) {
        const { data, error } = await publicClient
          .schema('public')
          .from('public_members')
          .select('avatar_path, avatar_updated_at')
          .eq('id', memberId)
          .maybeSingle()
        if (error) throw new Error('Could not read public member avatar metadata')
        if (!data) return null
        return {
          avatarPath: data.avatar_path,
          avatarUpdatedAt: data.avatar_updated_at,
        }
      },
      async downloadAvatar(objectKey) {
        const { data, error } = await serviceClient.storage.from(bucket).download(objectKey)
        if (error || !data) throw new Error('Could not download member avatar object')
        return await data.arrayBuffer()
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('member-avatar', request, error))
  },
})

Deno.serve(handler)
