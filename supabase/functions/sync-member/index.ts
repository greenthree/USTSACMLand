import { createClient } from '@supabase/supabase-js'
import { adapters } from '../_shared/adapters/index.ts'
import { createXcpcEloAdapter } from '../_shared/adapters/xcpc-elo.ts'
import { notifySyncFailure } from '../_shared/alerts.ts'
import { notifyRuntimeError } from '../_shared/error-monitoring.ts'
import {
  createRuntimeNowcoderAdapter,
  createRuntimeQojAdapter,
} from '../_shared/firecrawl-runtime-adapters.ts'
import { createSupabaseXcpcDatasetLoader } from '../_shared/xcpc-cache.ts'
import { createSyncMemberHandler } from './handler.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const handler = createSyncMemberHandler({
  allowedOrigins: Deno.env.get('ALLOWED_ORIGIN'),
  createClient() {
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    return {
      client: createClient(requiredEnv('SUPABASE_URL'), serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
      serviceRoleKey,
    }
  },
  resolveAdapter({ client, account, jobId, attempt, runId }) {
    switch (account.platform) {
      case 'xcpc_elo':
        return createXcpcEloAdapter(createSupabaseXcpcDatasetLoader(client))
      case 'qoj':
        return createRuntimeQojAdapter(client, {
          operationId: `qoj:${jobId}:${attempt}:${account.id}`,
          syncRunId: runId,
        })
      case 'nowcoder':
        return createRuntimeNowcoderAdapter(client)
      default:
        return adapters[account.platform]
    }
  },
  now: () => new Date(),
  notifySyncFailure,
  notifyRuntimeError,
})

Deno.serve(handler)
