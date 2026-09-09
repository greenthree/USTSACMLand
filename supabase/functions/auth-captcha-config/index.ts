import { createClient } from '@supabase/supabase-js'
import { resolveAuthenticatedUser } from '../webchat/authorization.ts'
import {
  AuthCaptchaConfigServiceError,
  createAuthCaptchaConfigHandler,
  type AuthCaptchaConfigUpdate,
} from './handler.ts'

const DEFAULT_ALLOWED_ORIGINS = [
  'http/workspace/083c59aebcd1',
  'http/workspace/dc4de279a9df',
  'htt/workspace/80f149278893',
  'htt/workspace/c7fd2dab7acc',
  'htt/workspace/500da4647f4d',
].join(',')

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function projectRef(): string {
  const url = new URL(requiredEnv('SUPABASE_URL'))
  const ref = url.hostname.split('.')[0]
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Invalid Supabase project reference')
  return ref
}

function retryAfterFromDatabaseError(details: unknown): number {
  if (typeof details !== 'string') return 60
  try {
    const parsed = JSON.parse(details) as { retry_after_seconds?: unknown }
    const seconds = Number(parsed.retry_after_seconds)
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
  } catch {
    return 60
  }
}

async function updateHostedAuthCaptcha(enabled: boolean): Promise<void> {
  const endpoint = `http/workspace/f535d5bd192f/v1/projects/${projectRef()}/config/auth`
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${requiredEnv('SUPABASE_MANAGEMENT_TOKEN')}`,
    'content-type': 'application/json',
  }
  const update = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ captcha_enabled: enabled }),
  })
  if (!update.ok) throw new AuthCaptchaConfigServiceError('management_unavailable')

  const verified = await fetch(endpoint, { headers })
  if (!verified.ok) throw new AuthCaptchaConfigServiceError('management_unavailable')
  const body = (await verified.json()) as Record<string, unknown>
  if (body.captcha_enabled !== enabled) {
    throw new AuthCaptchaConfigServiceError('management_unavailable')
  }
}

const handler = createAuthCaptchaConfigHandler({
  allowedOrigins: Deno.env.get('CHAT_ALLOWED_ORIGINS')?.trim() || DEFAULT_ALLOWED_ORIGINS,
  createServices() {
    const serviceClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const readConfig = async () => {
      const { data, error } = await serviceClient.rpc('read_auth_captcha_config')
      if (error) throw new Error('Could not read Auth CAPTCHA configuration')
      const row = Array.isArray(data) ? data[0] : data
      if (!row || typeof row !== 'object') throw new Error('Auth CAPTCHA configuration is invalid')
      const value = row as Record<string, unknown>
      if (
        typeof value.enabled !== 'boolean' ||
        !Number.isSafeInteger(Number(value.version)) ||
        typeof value.updated_at !== 'string'
      ) {
        throw new Error('Auth CAPTCHA configuration is invalid')
      }
      return {
        enabled: value.enabled,
        version: Number(value.version),
        updatedAt: value.updated_at,
      }
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
        if (error) throw new Error('Could not verify administrator state')
        return data ? { role: data.role, reviewStatus: data.review_status } : null
      },
      readConfig,
      async updateConfig(userId: string, update: AuthCaptchaConfigUpdate) {
        const current = await readConfig()
        if (current.version !== update.expectedVersion) {
          throw new AuthCaptchaConfigServiceError('conflict')
        }
        try {
          await updateHostedAuthCaptcha(update.enabled)
        } catch (error) {
          try {
            await updateHostedAuthCaptcha(current.enabled)
          } catch {
            // The public read endpoint will expose the mismatch for manual reconciliation.
          }
          if (error instanceof AuthCaptchaConfigServiceError) throw error
          throw new AuthCaptchaConfigServiceError('management_unavailable')
        }
        const { data, error } = await serviceClient.rpc('admin_commit_auth_captcha_config', {
          actor_id: userId,
          requested_enabled: update.enabled,
          expected_version: update.expectedVersion,
          requested_reason: update.reason,
        })
        if (error) {
          try {
            await updateHostedAuthCaptcha(current.enabled)
          } catch {
            // Keep the hosted setting untouched only when rollback succeeds;
            // the next read exposes the mismatch for manual reconciliation.
          }
          if (error.message.includes('admin_rate_limited')) {
            throw new AuthCaptchaConfigServiceError(
              'rate_limited',
              retryAfterFromDatabaseError(error.details),
            )
          }
          if (error.code === '40001') throw new AuthCaptchaConfigServiceError('conflict')
          if (error.code === '42501') throw new AuthCaptchaConfigServiceError('forbidden')
          if (['22001', '22004', '22023'].includes(error.code ?? '')) {
            throw new AuthCaptchaConfigServiceError('invalid_request')
          }
          throw new Error('Could not commit Auth CAPTCHA configuration')
        }
        const row = Array.isArray(data) ? data[0] : data
        if (!row || typeof row !== 'object')
          throw new Error('Auth CAPTCHA configuration is invalid')
        const value = row as Record<string, unknown>
        if (typeof value.enabled !== 'boolean' || !Number.isSafeInteger(Number(value.version))) {
          throw new Error('Auth CAPTCHA configuration is invalid')
        }
        return {
          enabled: value.enabled,
          version: Number(value.version),
          updatedAt: String(value.updated_at),
        }
      },
    }
  },
})

Deno.serve(handler)
