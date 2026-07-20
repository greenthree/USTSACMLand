import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import {
  readFirecrawlRuntimeKey,
  recordFirecrawlObservation,
} from '../_shared/firecrawl-key-pool.ts'
import { readFirecrawlCreditUsage } from '../_shared/firecrawl-usage.ts'
import { resolveAuthenticatedUser } from '../webchat/authorization.ts'
import { creditFailureCode } from '../sync-stats/firecrawl-credit-monitor.ts'
import { parseFirecrawlKey, parseFirecrawlKeys, retryAfterFromDatabaseError } from './config.ts'
import {
  createFirecrawlConfigHandler,
  FirecrawlConfigServiceError,
  type FirecrawlKeyView,
} from './handler.ts'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://ustsacm.fun',
  'https://greenthree.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
].join(',')

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function mapDatabaseError(error: {
  code?: string
  message: string
  details?: string | null
}): never {
  if (error.message.includes('admin_rate_limited')) {
    throw new FirecrawlConfigServiceError(
      'rate_limited',
      retryAfterFromDatabaseError(error.details),
    )
  }
  if (error.code === '40001') throw new FirecrawlConfigServiceError('conflict')
  if (error.code === '42501') throw new FirecrawlConfigServiceError('forbidden')
  if (error.code === 'P0002') throw new FirecrawlConfigServiceError('not_found')
  if (['22001', '22004', '22023', '23505'].includes(error.code ?? '')) {
    throw new FirecrawlConfigServiceError('invalid_request')
  }
  throw new Error('Could not update Firecrawl key configuration')
}

const handler = createFirecrawlConfigHandler({
  allowedOrigins: Deno.env.get('CHAT_ALLOWED_ORIGINS')?.trim() || DEFAULT_ALLOWED_ORIGINS,
  maxBodyBytes: 16_384,
  createServices() {
    const serviceClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    async function listKeys(userId: string): Promise<FirecrawlKeyView[]> {
      const { data, error } = await serviceClient.rpc('admin_list_firecrawl_api_keys', {
        actor_id: userId,
      })
      if (error) mapDatabaseError(error)
      return parseFirecrawlKeys(data)
    }

    return {
      async getUser(token: string) {
        const { data, error } = await serviceClient.auth.getUser(token)
        return resolveAuthenticatedUser(data, error)
      },
      async getAdminState(userId: string) {
        const { data, error } = await serviceClient
          .from('profiles')
          .select('role, review_status')
          .eq('id', userId)
          .maybeSingle()
        if (error) throw new Error('Could not verify Firecrawl administrator state')
        return data ? { role: data.role, reviewStatus: data.review_status } : null
      },
      listKeys,
      async upsertKey(userId, update) {
        const { data, error } = await serviceClient.rpc('admin_upsert_firecrawl_api_key', {
          actor_id: userId,
          target_key_id: update.keyId,
          requested_label: update.label,
          replacement_api_key: update.apiKey,
          requested_enabled: update.enabled,
          requested_priority: update.priority,
          expected_version: update.expectedVersion,
          reason: update.reason,
        })
        if (error) mapDatabaseError(error)
        return parseFirecrawlKey(data)
      },
      async deleteKey(userId, keyId, expectedVersion, reason) {
        const { data, error } = await serviceClient.rpc('admin_delete_firecrawl_api_key', {
          actor_id: userId,
          target_key_id: keyId,
          expected_version: expectedVersion,
          reason,
        })
        if (error) mapDatabaseError(error)
        if (typeof data !== 'string') throw new Error('Firecrawl delete RPC returned invalid data')
        return data
      },
      async checkKey(userId, keyId) {
        const { error: rateError } = await serviceClient.rpc('consume_admin_rate_limit', {
          rate_actor_id: userId,
          rate_action_key: 'firecrawl_keys.check',
          rate_max_requests: 10,
          rate_window_seconds: 300,
        })
        if (rateError) mapDatabaseError(rateError)

        const runtimeKey = await readFirecrawlRuntimeKey(serviceClient, keyId)
        if (!runtimeKey) throw new FirecrawlConfigServiceError('not_found')
        let succeeded = false
        let errorCode: string | null = null
        try {
          const usage = await readFirecrawlCreditUsage({
            apiKey: runtimeKey.apiKey,
            apiUrl: runtimeKey.apiUrl,
          })
          if (!usage.configured || usage.remainingCredits === null || usage.planCredits === null) {
            throw new Error('Firecrawl credit usage returned incomplete data')
          }
          await recordFirecrawlObservation(serviceClient, runtimeKey, 'admin_check', true, null, {
            remainingCredits: usage.remainingCredits,
            planCredits: usage.planCredits,
            billingPeriodEnd: usage.billingPeriodEnd,
            severity: usage.severity,
          })
          succeeded = true
        } catch (error) {
          errorCode = creditFailureCode(error)
          await recordFirecrawlObservation(
            serviceClient,
            runtimeKey,
            'admin_check',
            false,
            errorCode,
          )
        }
        const key = (await listKeys(userId)).find((candidate) => candidate.id === keyId)
        if (!key) throw new FirecrawlConfigServiceError('not_found')
        return { key, succeeded, errorCode }
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('firecrawl-config', request, error))
  },
})

Deno.serve(handler)
