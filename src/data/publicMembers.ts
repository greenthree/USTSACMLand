import type { SupabaseClient } from '@supabase/supabase-js'
import { mapPublicStatStatus } from '../lib/memberStats'
import type { Database } from '../types/database'
import { platforms, type Member, type Platform, type PlatformStat } from '../types/domain'
import { buildProfilePlatformCursorFilter, collectCursorPages } from './cursorPagination'

interface PublicMemberRow {
  id: string
  full_name: string
  major: string
  grade: string
  created_at: string
}

interface PublicAccountRow {
  profile_id: string
  platform: Platform
  external_id: string
}

interface PublicStatRow {
  profile_id: string
  platform: Platform
  current_rating: number | null
  max_rating: number | null
  solved_count: number | null
  status: string
  last_success_at: string | null
}

const publicViewPageSize = 500

function requirePublicMemberRows(
  rows: Array<{
    id: string | null
    full_name: string | null
    major: string | null
    grade: string | null
    created_at: string | null
  }>,
): PublicMemberRow[] {
  return rows.map((row) => {
    if (!row.id || !row.full_name || !row.major || !row.grade || !row.created_at) {
      throw new Error('公开成员视图返回了不完整记录')
    }
    return {
      id: row.id,
      full_name: row.full_name,
      major: row.major,
      grade: row.grade,
      created_at: row.created_at,
    }
  })
}

function requirePublicAccountRows(
  rows: Array<{
    profile_id: string | null
    platform: Platform | null
    external_id: string | null
  }>,
): PublicAccountRow[] {
  return rows.map((row) => {
    if (!row.profile_id || !row.platform || !row.external_id) {
      throw new Error('公开平台账号视图返回了不完整记录')
    }
    return {
      profile_id: row.profile_id,
      platform: row.platform,
      external_id: row.external_id,
    }
  })
}

function requirePublicStatRows(
  rows: Array<{
    profile_id: string | null
    platform: Platform | null
    current_rating: number | null
    max_rating: number | null
    solved_count: number | null
    status: string | null
    last_success_at: string | null
  }>,
): PublicStatRow[] {
  return rows.map((row) => {
    if (!row.profile_id || !row.platform || !row.status) {
      throw new Error('公开平台统计视图返回了不完整记录')
    }
    return {
      profile_id: row.profile_id,
      platform: row.platform,
      current_rating: row.current_rating,
      max_rating: row.max_rating,
      solved_count: row.solved_count,
      status: row.status,
      last_success_at: row.last_success_at,
    }
  })
}

function emptyStat(platform: Platform): PlatformStat {
  return {
    platform,
    externalId: '',
    rating: null,
    peakRating: null,
    solved: null,
    status: 'missing',
    updatedAt: null,
  }
}

export async function loadPublicMembersFromClient(
  client: SupabaseClient<Database>,
): Promise<Member[]> {
  const [memberRows, accountRows, statRows] = await Promise.all([
    collectCursorPages<PublicMemberRow>(
      async (cursor) => {
        let query = client
          .from('public_members')
          .select('id, full_name, major, grade, created_at')
          .order('id', { ascending: true })
          .limit(publicViewPageSize)
        if (cursor) query = query.gt('id', cursor.id)
        const result = await query
        return {
          data: result.error ? null : requirePublicMemberRows(result.data ?? []),
          error: result.error,
        }
      },
      (row) => row.id,
      publicViewPageSize,
    ),
    collectCursorPages<PublicAccountRow>(
      async (cursor) => {
        let query = client
          .from('public_platform_accounts')
          .select('profile_id, platform, external_id')
          .order('profile_id', { ascending: true })
          .order('platform', { ascending: true })
          .limit(publicViewPageSize)
        if (cursor) query = query.or(buildProfilePlatformCursorFilter(cursor))
        const result = await query
        return {
          data: result.error ? null : requirePublicAccountRows(result.data ?? []),
          error: result.error,
        }
      },
      (row) => `${row.profile_id}:${row.platform}`,
      publicViewPageSize,
    ),
    collectCursorPages<PublicStatRow>(
      async (cursor) => {
        let query = client
          .from('public_platform_stats')
          .select(
            'profile_id, platform, current_rating, max_rating, solved_count, status, last_success_at',
          )
          .order('profile_id', { ascending: true })
          .order('platform', { ascending: true })
          .limit(publicViewPageSize)
        if (cursor) query = query.or(buildProfilePlatformCursorFilter(cursor))
        const result = await query
        return {
          data: result.error ? null : requirePublicStatRows(result.data ?? []),
          error: result.error,
        }
      },
      (row) => `${row.profile_id}:${row.platform}`,
      publicViewPageSize,
    ),
  ])

  const accountsByMember = new Map<string, PublicAccountRow[]>()
  for (const account of accountRows) {
    const rows = accountsByMember.get(account.profile_id) ?? []
    rows.push(account)
    accountsByMember.set(account.profile_id, rows)
  }

  const statsByMember = new Map<string, PublicStatRow[]>()
  for (const stat of statRows) {
    const rows = statsByMember.get(stat.profile_id) ?? []
    rows.push(stat)
    statsByMember.set(stat.profile_id, rows)
  }

  return memberRows.map((profile) => {
    const stats = Object.fromEntries(
      platforms.map((platform) => [platform, emptyStat(platform)]),
    ) as Record<Platform, PlatformStat>

    for (const account of accountsByMember.get(profile.id) ?? []) {
      stats[account.platform].externalId = account.external_id
    }
    for (const item of statsByMember.get(profile.id) ?? []) {
      stats[item.platform] = {
        ...stats[item.platform],
        rating: item.current_rating,
        peakRating: item.max_rating,
        solved: item.solved_count,
        status: mapPublicStatStatus(item.status, item.platform, item.last_success_at),
        updatedAt: item.last_success_at,
      }
    }

    return {
      id: profile.id,
      name: profile.full_name,
      major: profile.major,
      grade: profile.grade,
      bio: '',
      reviewStatus: 'approved',
      joinedAt: profile.created_at.slice(0, 10),
      stats,
    }
  })
}
