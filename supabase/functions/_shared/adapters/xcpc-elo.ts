import { fetchWithRetry, HttpError, toAdapterHttpError } from '../http.ts'
import { type AdapterResult, failure, type PlatformAdapter, success } from './types.ts'

export interface XcpcPlayer {
  id: string
  organization?: string
  teamMember?: string
  rating?: number
  maxRating?: number
  contests?: number
  history?: unknown[]
}

export interface XcpcDataset {
  generatedAt?: string
  players?: XcpcPlayer[]
  cacheVersion?: number
}

export type XcpcDatasetLoader = (signal?: AbortSignal) => Promise<XcpcDataset>

const DEFAULT_DATA_URL = 'https://zzzzzzyt.github.io/xcpc-elo/data.js'
const DATA_PREFIX = 'window.__ELO_DATA__'
export const XCPC_TARGET_ORGANIZATION = '苏州科技大学'

export function normalizeXcpcIdentityPart(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function findXcpcPlayersByIdentity(
  players: readonly XcpcPlayer[],
  memberName: string,
  organization = XCPC_TARGET_ORGANIZATION,
): XcpcPlayer[] {
  const normalizedName = normalizeXcpcIdentityPart(memberName)
  const normalizedOrganization = normalizeXcpcIdentityPart(organization)
  if (!normalizedName || !normalizedOrganization) return []

  return players.filter(
    (candidate) =>
      normalizeXcpcIdentityPart(candidate.teamMember) === normalizedName &&
      normalizeXcpcIdentityPart(candidate.organization) === normalizedOrganization,
  )
}

export function computeXcpcHistoricalMaxRating(player: Pick<XcpcPlayer, 'history'>): number | null {
  const history = Array.isArray(player.history) ? player.history : []
  let best = Number.NEGATIVE_INFINITY

  for (const event of history) {
    if (!Array.isArray(event)) continue
    const rating = event[3]
    if (typeof rating === 'number' && Number.isFinite(rating) && rating > best) {
      best = rating
    }
  }

  return Number.isFinite(best) ? best : null
}

export function parseXcpcDataset(script: string): XcpcDataset {
  const assignment = script.indexOf('=')
  if (!script.slice(0, assignment).trim().startsWith(DATA_PREFIX) || assignment < 0) {
    throw new HttpError('XCPC ELO data assignment changed', 'schema_changed', false)
  }

  const json = script
    .slice(assignment + 1)
    .trim()
    .replace(/;\s*$/, '')
  let parsed: XcpcDataset
  try {
    parsed = JSON.parse(json) as XcpcDataset
  } catch {
    throw new HttpError('XCPC ELO data is not valid JSON', 'schema_changed', false)
  }
  if (!Array.isArray(parsed.players)) {
    throw new HttpError('XCPC ELO players array is missing', 'schema_changed', false)
  }
  return parsed
}

async function loadRemoteDataset(signal?: AbortSignal): Promise<XcpcDataset> {
  const response = await fetchWithRetry(Deno.env.get('XCPC_ELO_DATA_URL') ?? DEFAULT_DATA_URL, {
    signal,
    timeoutMs: 30_000,
    retries: 2,
  })
  return parseXcpcDataset(await response.text())
}

export function createXcpcEloAdapter(
  loadDataset: XcpcDatasetLoader = loadRemoteDataset,
): PlatformAdapter {
  return {
    platform: 'xcpc_elo',

    async sync(rawAccountId, context): Promise<AdapterResult> {
      const accountId = rawAccountId.trim()
      const memberName = context?.memberName?.trim()
      if (!memberName) {
        return failure(
          'xcpc_elo',
          accountId,
          'invalid_account',
          'Member name is required to find an XCPC ELO player',
          false,
        )
      }

      try {
        const dataset = await loadDataset(context?.signal)
        const players = dataset.players
        if (!Array.isArray(players)) {
          return failure(
            'xcpc_elo',
            accountId,
            'schema_changed',
            'XCPC ELO players array is missing',
            false,
          )
        }
        const matches = findXcpcPlayersByIdentity(players, memberName)
        if (matches.length === 0) {
          return failure(
            'xcpc_elo',
            accountId,
            'not_found',
            `No XCPC ELO player matched this member at ${XCPC_TARGET_ORGANIZATION}`,
            false,
          )
        }
        if (matches.length > 1) {
          return failure(
            'xcpc_elo',
            accountId,
            'invalid_account',
            `Multiple XCPC ELO players matched this member at ${XCPC_TARGET_ORGANIZATION}`,
            false,
            { matchCount: matches.length },
          )
        }

        const player = matches[0]
        if (!/^xcpc_[a-f0-9]{16}$/i.test(player.id)) {
          return failure(
            'xcpc_elo',
            accountId,
            'schema_changed',
            'XCPC ELO player ID format changed',
            false,
          )
        }
        if (!Number.isFinite(player.rating)) {
          return failure(
            'xcpc_elo',
            player.id,
            'schema_changed',
            'XCPC ELO player rating field is invalid',
            false,
          )
        }
        const rawCacheVersion: unknown = dataset.cacheVersion
        if (
          rawCacheVersion !== undefined &&
          (!Number.isSafeInteger(rawCacheVersion) || Number(rawCacheVersion) < 1)
        ) {
          return failure(
            'xcpc_elo',
            player.id,
            'schema_changed',
            'XCPC ELO cache version is invalid',
            false,
          )
        }
        const cacheVersion = rawCacheVersion as number | undefined
        if (
          cacheVersion !== undefined &&
          player.maxRating !== undefined &&
          player.maxRating !== null &&
          !Number.isFinite(player.maxRating)
        ) {
          return failure(
            'xcpc_elo',
            player.id,
            'schema_changed',
            'XCPC ELO cached maximum rating is invalid',
            false,
          )
        }

        const rawGeneratedAt: unknown = dataset.generatedAt
        let sourceUpdatedAt: string | null = null
        if (rawGeneratedAt !== undefined) {
          if (typeof rawGeneratedAt !== 'string' || !Number.isFinite(Date.parse(rawGeneratedAt))) {
            return failure(
              'xcpc_elo',
              player.id,
              'schema_changed',
              'XCPC ELO source generation time is invalid',
              false,
            )
          }
          sourceUpdatedAt = new Date(rawGeneratedAt).toISOString()
        }

        const historicalMaxRating = cacheVersion
          ? Number.isFinite(player.maxRating)
            ? player.maxRating!
            : null
          : computeXcpcHistoricalMaxRating(player)

        return success(
          'xcpc_elo',
          player.id,
          {
            currentRating: player.rating!,
            maxRating: historicalMaxRating,
            solvedCount: null,
          },
          {
            sourceUpdatedAt,
            sourceVersion: cacheVersion
              ? `xcpc-elo-data-js-v2-cache-${cacheVersion}`
              : 'xcpc-elo-data-js-v2',
            details: {
              organization: player.organization ?? null,
              name: player.teamMember ?? null,
              contestCount: player.contests ?? null,
            },
          },
        )
      } catch (error) {
        const normalized = toAdapterHttpError(error)
        return failure(
          'xcpc_elo',
          accountId,
          normalized.code,
          normalized.message,
          normalized.retryable,
          normalized.details,
        )
      }
    },
  }
}

export const xcpcEloAdapter = createXcpcEloAdapter()
