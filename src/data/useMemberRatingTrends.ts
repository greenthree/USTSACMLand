import { useEffect, useState } from 'react'
import { buildDemoRatingSnapshots, fetchPublicRatingSnapshots } from '../lib/memberTrends'
import { hasSupabaseConfig } from '../lib/supabase'
import type { Member, RatingSnapshot } from '../types/domain'

export interface MemberRatingTrendsState {
  snapshots: RatingSnapshot[]
  loading: boolean
  error: string | null
  demo: boolean
}

interface LiveMemberRatingTrendsState extends MemberRatingTrendsState {
  profileId: string | null
}

export function useMemberRatingTrends(member: Member | undefined): MemberRatingTrendsState {
  const [state, setState] = useState<LiveMemberRatingTrendsState>({
    profileId: null,
    snapshots: [],
    loading: false,
    error: null,
    demo: false,
  })

  useEffect(() => {
    if (!member || !hasSupabaseConfig) return

    let active = true
    setState({ profileId: member.id, snapshots: [], loading: true, error: null, demo: false })
    fetchPublicRatingSnapshots(member.id)
      .then((snapshots) => {
        if (active) {
          setState({
            profileId: member.id,
            snapshots,
            loading: false,
            error: null,
            demo: false,
          })
        }
      })
      .catch(() => {
        if (!active) return
        setState({
          profileId: member.id,
          snapshots: [],
          loading: false,
          error: '公开 Rating 历史暂时无法读取，请稍后重试。',
          demo: false,
        })
      })

    return () => {
      active = false
    }
  }, [member])

  if (!member) {
    return { snapshots: [], loading: false, error: null, demo: !hasSupabaseConfig }
  }
  if (!hasSupabaseConfig) {
    return {
      snapshots: buildDemoRatingSnapshots(member),
      loading: false,
      error: null,
      demo: true,
    }
  }
  if (state.profileId !== member.id) {
    return { snapshots: [], loading: true, error: null, demo: false }
  }
  return state
}
