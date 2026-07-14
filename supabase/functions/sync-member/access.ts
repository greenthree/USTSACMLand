export const SYNC_TRIGGER_TYPES = [
  'scheduled',
  'manual',
  'registration',
  'account_changed',
  'retry',
] as const

export type SyncTriggerType = (typeof SYNC_TRIGGER_TYPES)[number]

export const REGISTRATION_SYNC_WINDOW_MS = 10 * 60 * 1000
const REGISTRATION_CLOCK_SKEW_MS = 60 * 1000

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

export function canRequestSync(
  requester: SyncRequester,
  triggerType: SyncTriggerType,
  platforms?: readonly string[],
): boolean {
  if (requester.serviceRole) return true
  if (requester.admin) return ADMIN_TRIGGER_TYPES.includes(triggerType)
  return triggerType === 'registration' && platforms?.length === 1 && platforms[0] === 'xcpc_elo'
}

export function isRegistrationSyncWindowOpen(
  profileCreatedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!profileCreatedAt) return false
  const createdAt = Date.parse(profileCreatedAt)
  if (!Number.isFinite(createdAt)) return false
  const age = now - createdAt
  return age >= -REGISTRATION_CLOCK_SKEW_MS && age <= REGISTRATION_SYNC_WINDOW_MS
}
