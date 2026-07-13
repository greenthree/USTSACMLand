import { useContext } from 'react'
import { MembersDataContext } from './membersDataContext'

export function useMembersData() {
  return useContext(MembersDataContext)
}
