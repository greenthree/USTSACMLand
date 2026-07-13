export const SYNC_TRIGGER_TYPES = [
  'scheduled',
  'manual',
  'registration',
  'account_changed',
  'retry',
] as const

export type SyncTriggerType = (typeof SYNC_TRIGGER_TYPES)[number]

interface SyncRequester {
  serviceRole: boolean
  admin: boolean
}

const ADMIN_TRIGGER_TYPES: SyncTriggerType[] = [
  'manual',
  'registration',
  'account_changed',
  'retry',
]

export function canRequestSync(requester: SyncRequester, triggerType: SyncTriggerType): boolean {
  if (requester.serviceRole) return true
  return requester.admin && ADMIN_TRIGGER_TYPES.includes(triggerType)
}
