import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import {
  defaultMembersDataState,
  MembersDataContext,
  type MembersDataState,
} from './membersDataContext'
import { mockMembers } from './mock'
import { loadPublicMembersFromClient } from './publicMembers'

async function loadPublicMembers() {
  return supabase ? loadPublicMembersFromClient(supabase) : mockMembers
}

export function MembersDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MembersDataState>(() =>
    hasSupabaseConfig
      ? { members: [], loading: true, error: null, demo: false }
      : defaultMembersDataState,
  )

  const reload = useCallback(async () => {
    if (!hasSupabaseConfig) return
    setState((curr) => ({ ...curr, loading: true, error: null }))
    try {
      const members = await loadPublicMembers()
      setState({ members, loading: false, error: null, demo: false })
    } catch (error: unknown) {
      setState({
        members: mockMembers,
        loading: false,
        error: error instanceof Error ? error.message : '公共榜单加载失败',
        demo: true,
      })
    }
  }, [])

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

  return (
    <MembersDataContext.Provider value={{ ...state, reload }}>
      {children}
    </MembersDataContext.Provider>
  )
}
