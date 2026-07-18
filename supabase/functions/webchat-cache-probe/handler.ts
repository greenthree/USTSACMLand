import type { WebChatRelayRuntimeConfig } from '../webchat/runtime-config.ts'
import { gatewayVerifiedJwtRole } from '../_shared/jwt.ts'
import { CacheProbeError, type CacheProbeResult, type CacheProbeRuntimeConfig } from './probe.ts'

export interface CacheProbeClaimResult {
  decision: string
  status: string
  retryAfterSeconds: number | null
  usageDate: string
  remainingGlobalRequests: number
  remainingGlobalTokens: number
}

export interface CacheProbeTransition {
  transitioned: boolean
  status: string
  chargedTokens: number
}

export interface CacheProbeServices {
  claim(input: {
    probeId: string
    ownerToken: string
    reservedTokens: number
    leaseSeconds: number
  }): Promise<CacheProbeClaimResult>
  readRuntimeConfig(): Promise<WebChatRelayRuntimeConfig>
  markStarted(probeId: string, ownerToken: string): Promise<boolean>
  finalize(
    probeId: string,
    ownerToken: string,
    outcome: string,
    result: CacheProbeResult | null,
  ): Promise<CacheProbeTransition>
  release(probeId: string, ownerToken: string, reason: string): Promise<boolean>
  run(config: CacheProbeRuntimeConfig): Promise<CacheProbeResult>
}

export interface CacheProbeHandlerDependencies {
  serviceRoleKey: string
  leaseSeconds: number
  timeoutMs: number
  reservationTokens(model: string): Promise<number>
  createServices(): CacheProbeServices
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter: number | null = null,
    readonly result: CacheProbeResult | null = null,
  ) {
    super(message)
  }
}

const encoder = new TextEncoder()

function equalSecret(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  if (leftBytes.length !== rightBytes.length) return false
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
}

function authorize(request: Request, serviceRoleKey: string): void {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+([^\s]+)$/i)
  if (
    !match ||
    (!equalSecret(match[1], serviceRoleKey) && gatewayVerifiedJwtRole(match[1]) !== 'service_role')
  ) {
    throw new ApiError(401, 'unauthorized', 'Service-role authorization is required')
  }
  if (request.headers.has('origin')) {
    throw new ApiError(403, 'browser_origin_rejected', 'Browser-origin requests are not allowed')
  }
}

function blockedClaim(claim: CacheProbeClaimResult): ApiError {
  const retryAfter = claim.retryAfterSeconds
  switch (claim.decision) {
    case 'active_concurrent':
      return new ApiError(409, claim.decision, 'Another cache probe is already active', retryAfter)
    case 'cooldown':
      return new ApiError(429, claim.decision, 'Cache probe cooldown is active', retryAfter)
    case 'relay_disabled':
      return new ApiError(503, claim.decision, 'WebChat relay is disabled or incomplete')
    case 'global_daily_request_limited':
    case 'global_daily_token_limited':
      return new ApiError(503, claim.decision, 'The global WebChat budget cannot admit the probe')
    case 'duplicate':
    case 'conflict':
      return new ApiError(409, claim.decision, 'Cache probe identity could not be acquired')
    default:
      return new ApiError(500, 'invalid_claim_decision', 'Cache probe claim returned invalid data')
  }
}

function responseBody(error: ApiError): Record<string, unknown> {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryAfterSeconds: error.retryAfter,
    },
    ...(error.result ? { probe: error.result } : {}),
  }
}

function jsonResponse(body: unknown, status: number, retryAfter: number | null = null): Response {
  const headers = new Headers({
    'cache-control': 'private, no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  if (retryAfter !== null) headers.set('retry-after', String(retryAfter))
  return new Response(JSON.stringify(body), { status, headers })
}

async function releaseOrThrow(
  services: CacheProbeServices,
  probeId: string,
  ownerToken: string,
  reason: string,
): Promise<void> {
  if (!(await services.release(probeId, ownerToken, reason))) {
    throw new ApiError(500, 'accounting_release_failed', 'Cache probe reservation was not released')
  }
}

export function createCacheProbeHandler(dependencies: CacheProbeHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'POST') {
        return new Response(null, {
          status: 405,
          headers: { allow: 'POST', 'cache-control': 'private, no-store' },
        })
      }
      authorize(request, dependencies.serviceRoleKey)

      const services = dependencies.createServices()
      let runtimeConfig: WebChatRelayRuntimeConfig
      try {
        runtimeConfig = await services.readRuntimeConfig()
      } catch {
        throw new ApiError(
          503,
          'runtime_config_failed',
          'WebChat relay configuration is unavailable',
        )
      }
      if (
        !runtimeConfig.requestsEnabled ||
        !runtimeConfig.baseUrl ||
        !runtimeConfig.apiKey ||
        !runtimeConfig.model
      ) {
        throw new ApiError(
          503,
          'runtime_config_disabled',
          'WebChat relay configuration is disabled',
        )
      }

      const reservedTokens = await dependencies.reservationTokens(runtimeConfig.model)
      const probeId = crypto.randomUUID()
      const ownerToken = crypto.randomUUID()
      const claim = await services.claim({
        probeId,
        ownerToken,
        reservedTokens,
        leaseSeconds: dependencies.leaseSeconds,
      })
      if (claim.decision !== 'acquired') throw blockedClaim(claim)

      if (!(await services.markStarted(probeId, ownerToken))) {
        await releaseOrThrow(services, probeId, ownerToken, 'claim_expired')
        throw new ApiError(409, 'claim_expired', 'Cache probe lease expired before upstream I/O')
      }

      let result: CacheProbeResult
      try {
        result = await services.run({
          baseUrl: runtimeConfig.baseUrl,
          apiKey: runtimeConfig.apiKey,
          model: runtimeConfig.model,
          timeoutMs: dependencies.timeoutMs,
        })
        if (result.aggregateUsage.totalTokens > reservedTokens) {
          throw new CacheProbeError(
            'usage_exceeds_reservation',
            'Cache probe usage exceeded its conservative reservation',
          )
        }
      } catch (error) {
        const probeError =
          error instanceof CacheProbeError
            ? error
            : new CacheProbeError('unexpected_probe_error', 'Cache probe failed unexpectedly')
        const transition = await services.finalize(
          probeId,
          ownerToken,
          probeError.code,
          probeError.knownResult,
        )
        if (!transition.transitioned) {
          throw new ApiError(
            500,
            'accounting_finalize_failed',
            'Cache probe usage could not be finalized',
          )
        }
        throw new ApiError(
          probeError.status,
          probeError.code,
          probeError.message,
          null,
          probeError.knownResult,
        )
      }

      const transition = await services.finalize(probeId, ownerToken, 'cache_hit', result)
      if (!transition.transitioned) {
        throw new ApiError(
          500,
          'accounting_finalize_failed',
          'Cache probe usage could not be finalized',
        )
      }

      return jsonResponse(
        {
          ok: true,
          checkedAt: new Date().toISOString(),
          usageDate: claim.usageDate,
          remainingGlobalRequests: claim.remainingGlobalRequests,
          remainingGlobalTokens: claim.remainingGlobalTokens,
          chargedTokens: transition.chargedTokens,
          probe: result,
        },
        200,
      )
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, 'internal_error', 'Cache probe could not be completed')
      return jsonResponse(responseBody(apiError), apiError.status, apiError.retryAfter)
    }
  }
}
