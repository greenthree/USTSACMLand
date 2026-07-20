import { createClient } from '@supabase/supabase-js'
import { notifyRuntimeError, runtimeErrorAlert } from '../_shared/error-monitoring.ts'
import { resolveAuthenticatedUser } from '../webchat/authorization.ts'
import {
  parseWebChatGlobalBudgetUsageView,
  parseWebChatRelayConfigView,
  retryAfterFromDatabaseError,
} from './config.ts'
import { createWebChatConfigHandler, WebChatConfigServiceError } from './handler.ts'

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

function mapUpdateError(error: { code?: string; message: string; details?: string | null }): never {
  if (error.message.includes('admin_rate_limited')) {
    throw new WebChatConfigServiceError('rate_limited', retryAfterFromDatabaseError(error.details))
  }
  if (error.code === '40001') throw new WebChatConfigServiceError('conflict')
  if (error.code === '42501') throw new WebChatConfigServiceError('forbidden')
  if (['22001', '22004', '22023'].includes(error.code ?? '')) {
    throw new WebChatConfigServiceError('invalid_request')
  }
  throw new Error('Could not update WebChat relay configuration')
}

const handler = createWebChatConfigHandler({
  allowedOrigins: Deno.env.get('CHAT_ALLOWED_ORIGINS')?.trim() || DEFAULT_ALLOWED_ORIGINS,
  maxBodyBytes: 16_384,
  createServices() {
    const serviceClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
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
        if (error) throw new Error('Could not verify WebChat administrator state')
        return data ? { role: data.role, reviewStatus: data.review_status } : null
      },
      async readConfig() {
        const { data, error } = await serviceClient.rpc('read_webchat_relay_config')
        if (error) throw new Error('Could not read WebChat relay configuration')
        return parseWebChatRelayConfigView(data)
      },
      async readBudgetUsage() {
        const { data, error } = await serviceClient.rpc('read_webchat_global_budget_usage')
        if (error) throw new Error('Could not read WebChat global budget usage')
        return parseWebChatGlobalBudgetUsageView(data)
      },
      async updateConfig(userId, update) {
        const { data, error } = await serviceClient.rpc('admin_update_webchat_relay_config', {
          actor_id: userId,
          requested_base_url: update.baseUrl,
          requested_model: update.model,
          requested_requests_enabled: update.requestsEnabled,
          requested_global_daily_request_limit: update.globalDailyRequestLimit,
          requested_global_daily_token_limit: update.globalDailyTokenLimit,
          replacement_api_key: update.apiKey,
          expected_version: update.expectedVersion,
          reason: update.reason,
        })
        if (error) mapUpdateError(error)
        return parseWebChatRelayConfigView(data)
      },
    }
  },
  async reportUnexpectedError(request, error) {
    await notifyRuntimeError(runtimeErrorAlert('webchat-config', request, error))
  },
})

Deno.serve(handler)
