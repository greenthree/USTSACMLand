import { createClient } from '@supabase/supabase-js'
import { resolveWebChatRelayRuntimeConfig } from '../webchat/runtime-config.ts'
import {
  createCacheProbeHandler,
  type CacheProbeClaimResult,
  type CacheProbeTransition,
} from './handler.ts'
import { cacheProbeReservationTokens, runCacheProbe, type CacheProbeResult } from './probe.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = Deno.env.get(name)?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function row(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Cache probe RPC returned invalid data')
  }
  return candidate as Record<string, unknown>
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Cache probe RPC returned invalid ${name}`)
  }
  return value
}

function nullableNonnegativeInteger(value: unknown, name: string): number | null {
  return value === null ? null : nonnegativeInteger(value, name)
}

function parseClaim(value: unknown): CacheProbeClaimResult {
  const candidate = row(value)
  if (
    typeof candidate.decision !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.usage_date !== 'string'
  ) {
    throw new Error('Cache probe claim returned invalid data')
  }
  return {
    decision: candidate.decision,
    status: candidate.status,
    retryAfterSeconds: nullableNonnegativeInteger(candidate.retry_after_seconds, 'retry delay'),
    usageDate: candidate.usage_date,
    remainingGlobalRequests: nonnegativeInteger(
      candidate.remaining_global_requests,
      'remaining request budget',
    ),
    remainingGlobalTokens: nonnegativeInteger(
      candidate.remaining_global_tokens,
      'remaining token budget',
    ),
  }
}

function parseTransition(value: unknown): CacheProbeTransition {
  const candidate = row(value)
  if (typeof candidate.transitioned !== 'boolean' || typeof candidate.status !== 'string') {
    throw new Error('Cache probe transition returned invalid data')
  }
  return {
    transitioned: candidate.transitioned,
    status: candidate.status,
    chargedTokens: nonnegativeInteger(candidate.charged_tokens, 'charged token count'),
  }
}

const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
const promptVersion =
  Deno.env.get('CHAT_SYSTEM_PROMPT_VERSION')?.trim() || 'usts-learning-assistant-v3-tool-safety'
const timeoutMs = integerEnv('WEBCHAT_CACHE_PROBE_TIMEOUT_MS', 120_000, 5_000, 120_000)
const leaseSeconds = Math.max(300, Math.ceil((timeoutMs * 2) / 1_000) + 30)

if (leaseSeconds > 600) {
  throw new Error('WEBCHAT_CACHE_PROBE_TIMEOUT_MS leaves no valid cache probe lease')
}

const handler = createCacheProbeHandler({
  serviceRoleKey,
  leaseSeconds,
  timeoutMs,
  promptVersion,
  reservationTokens: cacheProbeReservationTokens,
  createServices() {
    const serviceClient = createClient(requiredEnv('SUPABASE_URL'), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    return {
      async claim(input) {
        const { data, error } = await serviceClient.rpc('claim_webchat_cache_probe', {
          requested_probe_id: input.probeId,
          requested_owner_token: input.ownerToken,
          requested_reserved_tokens: input.reservedTokens,
          lease_seconds: input.leaseSeconds,
        })
        if (error) throw new Error('Could not claim cache probe budget')
        return parseClaim(data)
      },
      async readRuntimeConfig() {
        const { data, error } = await serviceClient.rpc('read_webchat_relay_runtime_config')
        if (error) throw new Error('Could not read WebChat relay runtime configuration')
        return resolveWebChatRelayRuntimeConfig(data, () => {
          throw new Error('Database WebChat relay configuration is required')
        })
      },
      async markStarted(probeId, ownerToken) {
        const { data, error } = await serviceClient.rpc('mark_webchat_cache_probe_started', {
          requested_probe_id: probeId,
          requested_owner_token: ownerToken,
        })
        if (error || typeof data !== 'boolean') {
          throw new Error('Could not mark cache probe started')
        }
        return data
      },
      async finalize(probeId, ownerToken, outcome, result: CacheProbeResult | null) {
        const usage = result?.aggregateUsage ?? null
        const { data, error } = await serviceClient.rpc('finalize_webchat_cache_probe', {
          requested_probe_id: probeId,
          requested_owner_token: ownerToken,
          probe_outcome: outcome,
          used_input_tokens: usage?.inputTokens ?? null,
          used_output_tokens: usage?.outputTokens ?? null,
          used_total_tokens: usage?.totalTokens ?? null,
          observed_cached_input_tokens: usage?.cachedInputTokens ?? null,
          observed_cache_write_tokens: usage?.cacheWriteTokens ?? null,
        })
        if (error) throw new Error('Could not finalize cache probe usage')
        return parseTransition(data)
      },
      async release(probeId, ownerToken, reason) {
        const { data, error } = await serviceClient.rpc('release_webchat_cache_probe', {
          requested_probe_id: probeId,
          requested_owner_token: ownerToken,
          release_reason: reason,
        })
        if (error || typeof data !== 'boolean') {
          throw new Error('Could not release cache probe reservation')
        }
        return data
      },
      run: runCacheProbe,
    }
  },
})

Deno.serve(handler)
