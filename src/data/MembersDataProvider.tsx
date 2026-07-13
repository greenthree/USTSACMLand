import { type ReactNode, useEffect, useState } from 'react'
import { mapPublicStatStatus } from '../lib/memberStats'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import { platforms, type Member, type Platform, type PlatformStat } from '../types/domain'
import {
  defaultMembersDataState,
  MembersDataContext,
  type MembersDataState,
} from './membersDataContext'
import { mockMembers } from './mock'

interface PublicMemberRow {
  id: string
  full_name: string | null
  major: string | null
  grade: string | null
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
  stale_after: string | null
  updated_at: string | null
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

async function loadPublicMembers(): Promise<Member[]> {
  if (!supabase) return mockMembers

  const [membersResult, accountsResult, statsResult] = await Promise.all([
    supabase.from('public_members').select('id, full_name, major, grade, created_at'),
    supabase.from('public_platform_accounts').select('profile_id, platform, external_id'),
    supabase
      .from('public_platform_stats')
      .select(
        'profile_id, platform, current_rating, max_rating, solved_count, status, stale_after, updated_at',
      ),
  ])

  const firstError = membersResult.error ?? accountsResult.error ?? statsResult.error
  if (firstError) throw firstError

  const accountsByMember = new Map<string, PublicAccountRow[]>()
  for (const account of (accountsResult.data ?? []) as PublicAccountRow[]) {
    const rows = accountsByMember.get(account.profile_id) ?? []
    rows.push(account)
    accountsByMember.set(account.profile_id, rows)
  }

  const statsByMember = new Map<string, PublicStatRow[]>()
  for (const stat of (statsResult.data ?? []) as PublicStatRow[]) {
    const rows = statsByMember.get(stat.profile_id) ?? []
    rows.push(stat)
    statsByMember.set(stat.profile_id, rows)
  }

  return ((membersResult.data ?? []) as PublicMemberRow[]).map((profile) => {
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
        status: mapPublicStatStatus(item.status, item.stale_after),
        updatedAt: item.updated_at,
      }
    }

    return {
      id: profile.id,
      name: profile.full_name ?? '未命名成员',
      major: profile.major ?? '未填写专业',
      grade: profile.grade ?? '未填写年级',
      bio: '',
      reviewStatus: 'approved',
      joinedAt: profile.created_at.slice(0, 10),
      stats,
    }
  })
}

export function MembersDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MembersDataState>(() =>
    hasSupabaseConfig
      ? { members: [], loading: true, error: null, demo: false }
      : defaultMembersDataState,
  )

  useEffect(() => {
    if (!hasSupabaseConfig) return
    let active = true

    loadPublicMembers()
      .then((members) => {
        if (active) setState({ members, loading: false, error: null, demo: false })
      })
      .catch((error: unknown) => {
        if (!active) return
        setState({
          members: mockMembers,
          loading: false,
          error: error instanceof Error ? error.message : '公共榜单加载失败',
          demo: true,
        })
      })

    return () => {
      active = false
    }
  }, [])

  return <MembersDataContext.Provider value={state}>{children}</MembersDataContext.Provider>
}
