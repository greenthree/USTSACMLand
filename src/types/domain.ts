export const platforms = ['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo', 'luogu', 'qoj'] as const

export type Platform = (typeof platforms)[number]
export type RatingPlatform = Extract<Platform, 'codeforces' | 'nowcoder' | 'atcoder' | 'xcpc_elo'>
export type SolvedPlatform = Extract<Platform, 'codeforces' | 'nowcoder' | 'luogu' | 'qoj'>
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type AccountVerificationStatus = 'pending' | 'verified' | 'invalid' | 'disabled'
export type AdminMemberStatus = 'active' | 'suspended'
export type SyncStatus = 'fresh' | 'stale' | 'error' | 'missing' | 'syncing'
export type SyncRunStatus = 'success' | 'running' | 'failed' | 'queued' | 'skipped'
export type SyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type SyncTriggerType = 'scheduled' | 'manual' | 'registration' | 'account_changed' | 'retry'

export interface PlatformStat {
  platform: Platform
  externalId: string
  rating: number | null
  peakRating: number | null
  solved: number | null
  status: SyncStatus
  updatedAt: string | null
}

export interface Member {
  id: string
  name: string
  major: string
  grade: string
  bio: string
  reviewStatus: ReviewStatus
  joinedAt: string
  stats: Record<Platform, PlatformStat>
}

export interface AdminPlatformAccount {
  id: number
  profileId: string
  memberName: string
  major: string
  email: string
  platform: Platform
  externalId: string
  status: AccountVerificationStatus
  verifiedAt: string | null
  verificationErrorCode: string | null
  verificationErrorMessage: string | null
  updatedAt: string
}

export interface AdminMember {
  id: string
  name: string
  email: string
  qq: string
  major: string
  grade: string
  status: AdminMemberStatus
  suspensionNote: string | null
  isPublic: boolean
  joinedAt: string
  updatedAt: string
  platformCount: number
  verifiedPlatformCount: number
}

export interface SyncRun {
  id: number
  jobId: number
  profileId: string
  platform: Platform
  memberName: string
  status: SyncRunStatus
  jobStatus: SyncJobStatus
  triggerType: SyncTriggerType
  requestedBy: string | null
  durationMs: number | null
  startedAt: string
  finishedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  sourceVersion: string | null
}

export interface AdminOverview {
  approvedMemberCount: number
  pendingMemberCount: number
  failedJobCount24h: number
  runningJobCount: number
  overdueStatCount: number
  credentialErrorCount: number
  verifiedAccountCount: number
}

export interface AdminSourceHealth {
  platform: Platform
  totalRuns: number
  succeededRuns: number
  failedRuns: number
  successRate: number | null
  averageDurationMs: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  latestErrorCode: string | null
}

export interface AdminSourceHealthGroup {
  id: 'official-api' | 'page-parsing' | 'authenticated-browser'
  label: string
  platforms: Platform[]
  platformLabel: string
  totalRuns: number
  succeededRuns: number
  failedRuns: number
  successRate: number | null
  averageDurationMs: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  latestErrorCode: string | null
}

export interface AdminSyncBatchResult {
  requested: number
  succeeded: number
  failed: number
}

export interface AdminSyncRetryResult {
  jobId: number | null
  memberId: string
  status: 'success' | 'failed'
}

export interface AuditEntry {
  id: number
  actorId: string | null
  actor: string
  action: string
  targetTable: string
  targetId: string | null
  target: string
  createdAt: string
  summary: string
}
