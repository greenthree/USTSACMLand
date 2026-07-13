import { createContext } from 'react'
import type { Member } from '../types/domain'
import { mockMembers } from './mock'

export interface MembersDataState {
  members: Member[]
  loading: boolean
  error: string | null
  demo: boolean
}

export const defaultMembersDataState: MembersDataState = {
  members: mockMembers,
  loading: false,
  error: null,
  demo: true,
}

export const MembersDataContext = createContext<MembersDataState>(defaultMembersDataState)
